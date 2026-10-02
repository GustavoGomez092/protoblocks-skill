#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

function inspect({ selector, minFontPx, minTapPx, checkTaps }) {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return [{ type: 'missing', detail: `${selector} not found` }];
  const out = [];
  const vw = document.documentElement.clientWidth;
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : '');
  const visible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  if (document.documentElement.scrollWidth > vw + 1) out.push({ type: 'overflow', detail: `page scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw}` });
  const all = [root, ...root.querySelectorAll('*')].filter(visible);
  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && cs.position !== 'fixed') out.push({ type: 'overflow', detail: `${desc(el)} extends to ${Math.round(r.right)}px (viewport ${vw})` });
    if (ownText(el) && parseFloat(cs.fontSize) < minFontPx) out.push({ type: 'small-text', detail: `${desc(el)} font-size ${cs.fontSize}` });
    if (checkTaps && el.matches('a[href],button,[role=button],input,select,textarea') && (r.width < minTapPx || r.height < minTapPx)) out.push({ type: 'tap-target', detail: `${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}` });
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) out.push({ type: 'broken-image', detail: el.currentSrc || el.getAttribute('src') || desc(el) });
  }
  const leaves = all.filter(ownText).slice(0, 300);
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i]; const b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
      const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
      const min = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (min && (ix * iy) / min > 0.2) out.push({ type: 'overlap', detail: `${desc(a)} overlaps ${desc(b)}` });
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
      const raw = await page.evaluate(inspect, { selector: selector ?? null, minFontPx, minTapPx, checkTaps: width <= 480 });
      for (const src of errors.images) raw.push({ type: 'image-timeout', detail: src });
      const seen = new Set();
      const issues = raw.filter((i) => { const k = `${i.type}|${i.detail}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 50);
      return { url, selector: selector ?? null, width, ok: issues.length === 0, issues };
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
