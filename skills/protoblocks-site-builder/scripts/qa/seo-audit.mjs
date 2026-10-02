#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REQUIRED_PROPS = {
  WebPage: ['name', 'url'], Organization: ['name', 'url'], FAQPage: ['mainEntity'], Question: ['name', 'acceptedAnswer'], Answer: ['text'],
  Product: ['name'], Service: ['name'], Event: ['name', 'startDate', 'location'], Review: ['itemReviewed', 'reviewRating', 'author'],
  HowTo: ['name', 'step'], BreadcrumbList: ['itemListElement'],
};

// NFC, lowercase, straight quotes and hyphens, single spaces: the same text however the editor or font typed it.
export const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase()
  .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
  .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();

// Words keep inner apostrophes and hyphens ("o'brien", "x-ray"); a hyphenated word also yields its parts.
const WORD = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;
const wordsOf = (s) => norm(s).match(WORD) ?? [];
const textWords = (s) => [...new Set(wordsOf(s).flatMap((w) => (w.includes('-') ? [w, ...w.split('-')] : [w])))];
// A light English stemmer: enough for plural / -ing / -er / -ed forms (plumber, plumbers, plumbing -> plumb).
export function stem(w) {
  let s = w;
  if (/ies$/.test(s) && s.length > 5) s = `${s.slice(0, -3)}y`;
  else if (/(s|x|z|ch|sh)es$/.test(s) && s.length > 5) s = s.slice(0, -2);
  else {
    const m = /(ing|ers|er|ed|s)$/.exec(s);
    if (m && !s.endsWith('ss') && s.length - m[1].length >= 3) s = s.slice(0, -m[1].length);
  }
  if (s.endsWith('e') && s.length > 3) s = s.slice(0, -1);
  return s;
}
const wordMatches = (k, t) => t.startsWith(k) || stem(t).startsWith(stem(k));
/** Yoast-style keyphrase match: every keyword word of 3+ characters (all words when none are) appears, in any order. */
export function keywordMissing(keyword, text) {
  const all = wordsOf(keyword);
  const kwWords = all.filter((w) => w.length >= 3).length ? all.filter((w) => w.length >= 3) : all;
  const tw = textWords(text);
  return kwWords.filter((k) => !tw.some((t) => wordMatches(k, t)));
}

// Required props apply to the nodes a page states: top-level nodes and @graph members, not values nested inside them.
function nodesOf(json) {
  const out = [];
  for (const n of [].concat(json)) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) continue;
    if (n['@type']) out.push(n);
    if (Array.isArray(n['@graph'])) out.push(...n['@graph'].filter((g) => g && typeof g === 'object' && !Array.isArray(g) && g['@type']));
  }
  return out;
}

export const NOINDEX_FIX = "Settings → Reading → 'Discourage search engines' is on (or the page is noindex); Yoast omits canonical. Ask the developer; never toggle it yourself.";

export function auditExtract(e, { focusKeyword, ogImageInfo }) {
  const checks = [];
  const add = (id, ok, detail, fix, warnOnly = false) => checks.push({ id, status: ok ? 'pass' : warnOnly ? 'warn' : 'fail', detail, ...(ok ? {} : { fix }) });
  const kw = norm(focusKeyword);
  const addKw = (id, ok, detail, fix, warnOnly = false) => (kw
    ? add(id, ok, detail, fix, warnOnly)
    : add(id, false, 'no focus keyword', 'Pass a non-empty focus keyword (--keyword).'));

  const h1s = e.h.filter((h) => h.level === 1);
  add('h1-count', h1s.length === 1, `${h1s.length} h1: ${h1s.map((h) => h.selector).join(', ') || 'none'}`, 'Exactly one h1 per page: demote extra section titles to h2 (block tagName/attribute).');
  const skips = e.h.slice(1).filter((h, i) => h.level > e.h[i].level + 1).map((h) => `${h.selector} (h${h.level})`);
  add('heading-order', skips.length === 0, skips.length ? `skipped levels at ${skips.join(', ')}` : 'ok', 'Use consecutive heading levels (h2 under h1, h3 under h2).', true);
  const kwText = (id, text, detail, fix) => {
    const missing = keywordMissing(kw, text);
    addKw(id, missing.length === 0, missing.length ? `${detail} (missing: ${missing.join(', ')})` : detail, fix);
  };
  kwText('kw-title', e.title, e.title, 'Put the focus keyword near the start of the SEO title.');
  const h1Missing = h1s.map((h) => keywordMissing(kw, h.text));
  const h1Ok = h1Missing.some((m) => m.length === 0);
  addKw('kw-h1', h1Ok, `${h1s[0]?.text ?? 'no h1'}${h1Ok || !h1s.length ? '' : ` (missing: ${h1Missing[0].join(', ')})`}`, 'Include the focus keyword in the h1 (or pick a keyword the h1 already uses).');
  kwText('kw-first-paragraph', e.firstParagraph, (e.firstParagraph ?? '').slice(0, 120), 'Mention the focus keyword in the first paragraph.');
  kwText('kw-description', e.metaDescription, e.metaDescription ?? 'missing', 'Include the focus keyword in the meta description.');
  const kwWords = kw.split(' ').filter((w) => w.length >= 3);
  const slug = (() => {
    let p;
    try { p = new URL(e.url).pathname; } catch { p = e.url ?? ''; }
    try { return decodeURIComponent(p); } catch { return p; }
  })();
  const slugTokens = norm(slug).split(/[-/_.]+/).filter(Boolean);
  addKw('kw-slug', kwWords.length > 0 && kwWords.every((w) => slugTokens.some((t) => t.startsWith(w))), kwWords.length ? slug : 'keyword has no words of 3+ characters to match', 'Consider a slug containing the keyword (ask before changing a published URL).', true);
  add('title-length', (e.title ?? '').length > 0 && (e.title ?? '').length <= 60, `${(e.title ?? '').length} chars`, 'Shorten the SEO title to ≤ 60 characters.');
  const dl = (e.metaDescription ?? '').length;
  add('description-length', dl >= 120 && dl <= 156, `${dl} chars`, 'Rewrite the meta description to 120–156 characters.');
  const noAlt = e.imgs.filter((i) => i.alt === null).map((i) => i.src);
  add('img-alt', noAlt.length === 0, noAlt.length ? `missing alt: ${noAlt.slice(0, 5).join(', ')}` : 'ok', 'Every <img> needs an alt attribute (empty only for decorative images).');
  add('internal-link', e.links.some((l) => l.internal), `${e.links.filter((l) => l.internal).length} internal links`, 'Link to at least one other page on the site (CTA, nav, footer links inside content).', true);

  const parseErrors = [];
  const nodes = [];
  for (const raw of e.jsonld) {
    try { nodes.push(...nodesOf(JSON.parse(raw))); } catch (err) { parseErrors.push(err.message); }
  }
  add('jsonld-parse', e.jsonld.length > 0 && parseErrors.length === 0, parseErrors.length ? parseErrors.join('; ') : `${e.jsonld.length} block(s)`, 'Fix the JSON-LD (check _proto_jsonld post meta and any block that prints ld+json).');
  const missing = [];
  for (const n of nodes) {
    for (const t of [].concat(n['@type'])) {
      for (const p of Object.hasOwn(REQUIRED_PROPS, t) ? REQUIRED_PROPS[t] : []) if (n[p] === undefined || n[p] === '' || (Array.isArray(n[p]) && !n[p].length)) missing.push(`${t}.${p}`);
    }
  }
  add('jsonld-required', missing.length === 0, missing.length ? `missing ${[...new Set(missing)].join(', ')}` : 'ok', 'Add the missing properties to the schema pieces.');

  const ogMissing = ['title', 'description', 'image', 'url'].filter((k) => !e.og?.[k]);
  add('og-tags', ogMissing.length === 0, ogMissing.length ? `missing og:${ogMissing.join(', og:')}` : 'ok', 'Set Open Graph values via seo.mjs apply.');
  const oi = ogImageInfo;
  add('og-image', !!oi && oi.ok && oi.width === 1200 && oi.height === 630, oi ? `HTTP ${oi.status} ${oi.width}x${oi.height}` : 'not fetched', 'Generate a 1200x630 OG image (og-image.mjs) and apply it.');
  const robots = norm(e.robots);
  const noindex = /(^|[\s,])noindex([\s,]|$)/.test(robots);
  if (noindex) add('canonical', !!e.canonical, e.canonical ?? `missing: the page is noindex (robots "${e.robots}")`, NOINDEX_FIX, true);
  else add('canonical', !!e.canonical, e.canonical ?? 'missing', 'Yoast prints the canonical; check the page is published and Yoast is active.');
  add('robots-noindex', !noindex, e.robots ? `robots "${e.robots}"` : 'no robots meta', `Search engines are told not to index this page. ${NOINDEX_FIX}`, true);

  return { pass: !checks.some((c) => c.status === 'fail'), checks };
}

export async function extractPage(page) {
  return page.evaluate(() => {
    const meta = (sel) => document.querySelector(sel)?.getAttribute('content') ?? null;
    const root = document.querySelector('main') ?? document.body;
    const sel = (el) => { const sec = el.closest('[id^="pb-s"]'); return `${sec ? `section#${sec.id} ` : ''}${el.tagName.toLowerCase()}`; };
    const host = location.host;
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('#wpadminbar, [hidden], [aria-hidden="true"]');
    return {
      url: location.href,
      title: document.title,
      metaDescription: meta('meta[name="description"]'),
      robots: meta('meta[name="robots" i]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      og: { title: meta('meta[property="og:title"]'), description: meta('meta[property="og:description"]'), image: meta('meta[property="og:image"]'), url: meta('meta[property="og:url"]') },
      h: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim(), selector: sel(h) })),
      firstParagraph: [...root.querySelectorAll('p')].filter(visible).map((p) => p.textContent.trim()).find((t) => t.length >= 40) ?? '',
      imgs: [...document.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), alt: i.hasAttribute('alt') ? i.getAttribute('alt') : null })),
      links: [...root.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), internal: a.host === host && !a.getAttribute('href').startsWith('#') })),
      jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
    };
  });
}

export async function seoAudit({ url, focusKeyword, out, browser }) {
  const { launchBrowser, openPage } = await import('./browser.mjs');
  const { default: sharp } = await import('sharp');
  const own = !browser;
  const b = browser ?? await launchBrowser();
  try {
    const { page, context, status } = await openPage(b, { url, width: 1440 });
    try {
      if (status >= 400) {
        const err = new Error(`${url} returned HTTP ${status}; audit the published page (check the URL, and that the page is published and the site is running).`);
        err.code = 'EHTTP';
        throw err;
      }
      const at = new Date().toISOString();
      const e = await extractPage(page);
      let ogImageInfo = null;
      if (e.og.image) {
        try {
          const res = await context.request.get(new URL(e.og.image, e.url).href, { timeout: 15000 });
          const meta = res.ok() ? await sharp(await res.body()).metadata() : {};
          ogImageInfo = { ok: res.ok(), status: res.status(), width: meta.width ?? 0, height: meta.height ?? 0 };
        } catch (err) { ogImageInfo = { ok: false, status: 0, width: 0, height: 0, error: err.message }; }
      }
      // url, focusKeyword and at let `seo.mjs record-audit` reject an audit of another page, keyword or an older apply.
      const result = { url, focusKeyword, at, ...auditExtract(e, { focusKeyword, ogImageInfo }), extract: e };
      if (out) fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
      return result;
    } finally { await context.close(); }
  } finally { if (own) await b.close(); }
}

// Exit codes: 0 all checks pass (warnings allowed), 1 a check failed, 2 the audit could not run, 64 usage.
async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.url || !a.keyword) { process.stderr.write('Usage: node seo-audit.mjs --url U --keyword "<kw>" [--out audit.json]\n'); process.exit(64); }
  const r = await seoAudit({ url: a.url, focusKeyword: a.keyword, out: a.out });
  const { extract, ...summary } = r;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!r.pass) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(2); });
}
