#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

function inspect({ selector, minFontPx, minTapPx, checkTaps, pendingImages }) {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return [{ type: 'missing', detail: `${selector} not found` }];
  const out = [];
  const vw = document.documentElement.clientWidth;
  // Desktop captions/eyebrows at 12-13px are legitimate; only mobile gets the stricter floor.
  const fontFloor = checkTaps ? minFontPx : Math.min(minFontPx, 12);
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : '');
  const visible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const decorative = (el) => !!el.closest('[aria-hidden="true"],[inert]');
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };
  const transparent = (el) => { for (let p = el; p && p !== root.parentElement; p = p.parentElement) { if (getComputedStyle(p).opacity === '0') return true; } return false; };
  const srOnly = (el) => { const sr = el.closest('.sr-only,.screen-reader-text,.visually-hidden'); if (sr) return true; for (let p = el; p && p !== root.parentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.position === 'absolute' && (cs.clip !== 'auto' || cs.clipPath.startsWith('inset(50%'))) return true; } return false; };
  const inlineLink = (el) => {
    if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline' || !el.parentElement) return false;
    return [...el.parentElement.childNodes].some((n) => n !== el && ((n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && n.tagName !== 'A' && n.textContent.trim() && getComputedStyle(n).display.startsWith('inline'))));
  };
  if (document.documentElement.scrollWidth > vw + 1) out.push({ type: 'overflow', detail: `page scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw}` });
  const all = [root, ...root.querySelectorAll('*')].filter(visible);
  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const hidden = decorative(el);
    if (!hidden && r.right > vw + 1 && cs.position !== 'fixed' && !clippedByAncestor(el)) out.push({ type: 'overflow', detail: `${desc(el)} extends to ${Math.round(r.right)}px (viewport ${vw})` });
    if (!hidden && ownText(el) && parseFloat(cs.fontSize) < fontFloor && !el.closest('sup,sub') && !srOnly(el)) out.push({ type: 'small-text', detail: `${desc(el)} font-size ${cs.fontSize}` });
    if (checkTaps && el.matches('a[href],button,[role=button],input,select,textarea') && (r.width < minTapPx || r.height < minTapPx)
      && !inlineLink(el) && !(el.matches('input[type=checkbox],input[type=radio]') && r.width < 2 && r.height < 2)) out.push({ type: 'tap-target', detail: `${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}` });
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0 && (el.getAttribute('src') || el.getAttribute('srcset'))) out.push({ type: 'broken-image', detail: el.currentSrc || el.getAttribute('src') || desc(el) });
  }
  for (const img of root.querySelectorAll('img')) {
    const src = img.currentSrc || img.src;
    if (!img.complete && pendingImages.includes(src)) out.push({ type: 'image-timeout', detail: src });
  }
  const allLeaves = all.filter((el) => ownText(el) && !decorative(el) && !transparent(el));
  const leaves = allLeaves.slice(0, 300);
  if (allLeaves.length > 300) out.push({ type: 'note', detail: 'overlap check limited to first 300 text elements' });
  const lineBoxes = leaves.map((el) => [...el.getClientRects()].filter((q) => q.width > 0 && q.height > 0));
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i]; const b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const hit = lineBoxes[i].some((ra) => lineBoxes[j].some((rb) => {
        const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
        const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
        const min = Math.min(ra.width * ra.height, rb.width * rb.height);
        return min && (ix * iy) / min > 0.2;
      }));
      if (hit) out.push({ type: 'overlap', detail: `${desc(a)} overlaps ${desc(b)}` });
    }
  }
  return out;
}

export async function sanity({ url, selector, width, height = 900, browser, minFontPx = 14, minTapPx = 44 }) {
  const own = !browser;
  const b = browser ?? await launchBrowser();
  try {
    const { page, context, errors } = await openPage(b, { url, width, height });
    try {
      const raw = await page.evaluate(inspect, { selector: selector ?? null, minFontPx, minTapPx, checkTaps: width <= 480, pendingImages: errors.images });
      const seen = new Set();
      const notes = raw.filter((i) => i.type === 'note');
      const found = raw.filter((i) => i.type !== 'note').filter((i) => { const k = `${i.type}|${i.detail}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 50);
      const issues = [...found, ...notes];
      // notes are informational and never fail the check
      return { url, selector: selector ?? null, width, ok: issues.every((i) => i.type === 'note'), issues };
    } finally { await context.close(); }
  } finally { if (own) await b.close(); }
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.url || !a.width) { process.stderr.write('Usage: node sanity.mjs --url U --width W [--selector S]\n'); process.exit(64); }
  process.stdout.write(`${JSON.stringify(await sanity({ url: a.url, selector: a.selector, width: Number(a.width) }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
