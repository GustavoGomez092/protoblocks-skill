#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Only node built-ins at the top: page-qa.mjs (and the unit tests) import this module without the QA dependencies;
// axe, Playwright and the Taxi helpers load on first use.

export const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'];
export const BLOCKING_IMPACTS = ['serious', 'critical'];
// Moderate rules that block anyway. Each one caught a defect of the oflex.com client scan that page QA let through.
export const BLOCKING_RULES = [
  'landmark-unique', // the site-header block wrapped core/navigation in a second <nav aria-label="Primary">; three unlabelled footer navs
  'landmark-no-duplicate-main', // a block or template part adding its own <main> inside the template's
  'landmark-main-is-top-level', // a <main> rendered inside a header/footer/section landmark by a block
  'heading-order', // footer column titles as h3 under pages whose last heading was h1; location names h3 between h1 and h2
  'region', // content outside every landmark (a block rendered outside the template's header/main/footer)
];
export const SKIP_LINK_SELECTOR = '#wp-skip-link'; // core's skip link: a `region` node on it is info, never blocking

const MAX_NODES = 5;
const HTML_MAX = 120;
const NAV_READY_TIMEOUT_MS = 10000;
const CLICK_TIMEOUT_MS = 5000;
const ANCHOR = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const NO_TAXI_WARNING = 'afterNavigation skipped: theme has no Taxi ([data-taxi] not found), so aria-current after a page swap was not checked';
export const NO_LINK_WARNING = 'afterNavigation skipped: the header has no same-site link to another page';

// Axe nodes count only when they sit in page content: main/header/footer or a section anchor (#pb-s…). Tag names are
// matched as whole compound-selector heads so ".domain a", "#footer-widget a" and ".site-header a" do not qualify.
const TAG_SCOPE = /(?:^|[\s>+~(])(?:main|header|footer)(?![\w-])/;
const ANCHOR_SCOPE = /#pb-s/;
// Document-level rules (html-has-lang, document-title, meta-viewport...) report the root elements themselves.
const DOCUMENT_SCOPE = /^(?:html|body)$/;
const SKIP_LINK_TARGET = /#wp-skip-link(?![\w-])/;

const fail = (code, message) => Object.assign(new Error(message), { code });
const flatTargets = (node) => [].concat(node?.target ?? []).flat(Infinity).map(String);

// runAxe resolves each node in the page and sets node.inScope / node.skipLink; the selector-string match is the
// fallback for nodes it could not resolve (iframe/shadow targets) and for results that were not produced in a page.
const inScope = (node) => (typeof node?.inScope === 'boolean' ? node.inScope : flatTargets(node).some((t) => DOCUMENT_SCOPE.test(t) || TAG_SCOPE.test(t) || ANCHOR_SCOPE.test(t)));
const isSkipLink = (node) => (typeof node?.skipLink === 'boolean' ? node.skipLink : flatTargets(node).some((t) => SKIP_LINK_TARGET.test(t)));

const snippet = (html) => {
  const s = String(html ?? '').replace(/\s+/g, ' ').trim();
  return s.length > HTML_MAX ? `${s.slice(0, HTML_MAX - 1)}…` : s;
};

export function trimViolation(v) {
  return {
    id: v.id,
    impact: v.impact,
    help: v.help,
    helpUrl: v.helpUrl,
    tags: v.tags,
    nodes: (v.nodes ?? []).slice(0, MAX_NODES).map((n) => ({
      target: n.target ?? [],
      html: snippet(n.html),
      ...(typeof n.inScope === 'boolean' ? { inScope: n.inScope } : {}),
    })),
  };
}

export function filterViolations(violations, { blockingRules = BLOCKING_RULES } = {}) {
  const blocking = [];
  const other = [];
  for (const v of violations ?? []) {
    let nodes = v.nodes ?? [];
    if (v.id === 'region') {
      // WordPress core renders its skip link before every landmark; that is by design, so it is reported, not held
      // against the page. Its node may lie outside the page scopes, so it is split off before scoping.
      const skip = nodes.filter(isSkipLink);
      if (skip.length) other.push(trimViolation({ ...v, impact: 'info', nodes: skip }));
      nodes = nodes.filter((n) => !isSkipLink(n));
    }
    nodes = nodes.filter(inScope);
    if (!nodes.length) continue;
    const blocks = BLOCKING_IMPACTS.includes(v.impact) || blockingRules.includes(v.id);
    (blocks ? blocking : other).push(trimViolation({ ...v, nodes }));
  }
  return { blocking, other };
}

/** `site.qa.a11yBlocking` when set (validated), else the built-in moderate blocking list. */
export function blockingRulesFrom(qa = {}) {
  const r = qa?.a11yBlocking;
  if (r === undefined || r === null) return BLOCKING_RULES;
  if (!Array.isArray(r) || r.some((x) => typeof x !== 'string' || !x.trim())) {
    throw fail('EINPUT', `site.qa.a11yBlocking must be an array of axe rule ids (got ${JSON.stringify(r)}).`);
  }
  return r;
}

/**
 * Everything that runs inside the page, in one function so page.evaluate can ship it whole: the selector helper is
 * shared by every task. Tasks: resolve (axe targets to DOM flags), patterns, ariaCurrent, navLink, hasTaxi.
 */
function pageProbe({ task, root = null, groups = null, include = null }) {
  const adminBar = (el) => !!el.closest('#wpadminbar');
  const uniqueId = (id) => { try { return document.querySelectorAll(`#${CSS.escape(id)}`).length === 1; } catch { return false; } };
  const selectorOf = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.id && uniqueId(e.id)) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
      if (e === document.body || e === document.documentElement) { parts.unshift(e.localName); break; }
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.localName === e.localName) : [];
      parts.unshift(same.length > 1 ? `${e.localName}:nth-of-type(${same.indexOf(e) + 1})` : e.localName);
    }
    return parts.join(' > ');
  };
  const node = (el) => ({ target: [selectorOf(el)], html: el.outerHTML });
  const norm = (p) => p.replace(/\/+$/, '');

  if (task === 'hasTaxi') return !!document.querySelector('[data-taxi]');

  if (task === 'resolve') {
    // axe targets are the shortest unique selector (just "img"), so resolve the real DOM position of every node.
    const scope = include ? document.querySelector(include) : null;
    return groups.map((targets) => targets.map((t) => {
      if (!Array.isArray(t) || t.length !== 1 || typeof t[0] !== 'string') return null;
      try {
        const el = document.querySelector(t[0]);
        if (!el) return null;
        if (scope) return { inScope: scope.contains(el), skipLink: scope.contains(el) && !!el.closest('#wp-skip-link') };
        return { inScope: el === document.documentElement || el === document.body || !!el.closest('main, header, footer, [id^="pb-s"]'), skipLink: !!el.closest('#wp-skip-link') };
      } catch { return null; }
    }));
  }

  if (task === 'navLink') {
    const here = norm(location.pathname);
    const links = [...document.querySelectorAll('header a[href]')];
    const index = links.findIndex((a) => {
      const attr = a.getAttribute('href') || '';
      if (attr.startsWith('#') || a.hasAttribute('download') || a.hasAttribute('target') || adminBar(a)) return false;
      let u;
      try { u = new URL(a.href, location.href); } catch { return false; }
      if (!/^https?:$/.test(u.protocol) || u.origin !== location.origin || norm(u.pathname) === here) return false;
      // Playwright can only click what is rendered (a closed mobile menu's links are not).
      return a.getClientRects().length > 0 && getComputedStyle(a).visibility !== 'hidden';
    });
    return index < 0 ? null : { index, href: links[index].href };
  }

  if (task === 'ariaCurrent') {
    const here = norm(location.pathname);
    const current = (a) => a.getAttribute('aria-current') === 'page';
    const out = { missing: [], stale: [], hash: [] };
    for (const a of document.querySelectorAll('header a[href], footer a[href]')) {
      if (adminBar(a)) continue;
      const hasHash = (a.getAttribute('href') || '').includes('#');
      if (hasHash) continue; // reported below, with every other hash link
      let u = null;
      try { u = new URL(a.href, location.href); } catch { /* not a URL: never current */ }
      const must = !!u && /^https?:$/.test(u.protocol) && u.origin === location.origin && norm(u.pathname) === here;
      if (must && !current(a)) out.missing.push(selectorOf(a));
      if (!must && current(a)) out.stale.push(selectorOf(a));
    }
    // A hash link (a cookie-settings or in-page link) resolves to the current path but is never the current page.
    for (const a of document.querySelectorAll('a[href*="#"]')) if (!adminBar(a) && current(a)) out.hash.push(selectorOf(a));
    return { pass: !out.missing.length && !out.stale.length && !out.hash.length, ...out };
  }

  // task === 'patterns'
  const base = root ? document.querySelector(root) : document.documentElement;
  if (!base) return null;
  const all = (sel) => [...(base.matches(sel) ? [base] : []), ...base.querySelectorAll(sel)].filter((el) => !adminBar(el));
  const out = [];
  const add = (id, help, els) => { if (els.length) out.push({ id, impact: 'serious', help, helpUrl: null, nodes: els.slice(0, 5).map(node) }); };
  const NAV = 'nav, [role="navigation"]';

  add('tab-outside-tablist', 'Every [role=tab] must sit inside its [role=tablist] (aria-owns does not count)',
    all('[role="tab"]').filter((el) => !el.parentElement || !el.parentElement.closest('[role="tablist"]')));
  add('tabpanel-unlabelled', 'Every [role=tabpanel] needs aria-labelledby pointing at its [role=tab]',
    all('[role="tabpanel"]').filter((el) => !(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .some((id) => { const t = document.getElementById(id); return !!t && t.getAttribute('role') === 'tab'; })));
  add('tabpanel-in-tablist', 'A [role=tabpanel] must not sit inside the [role=tablist] (panels follow the tablist)',
    all('[role="tabpanel"]').filter((el) => el.parentElement && el.parentElement.closest('[role="tablist"]')));
  add('anchor-without-href', 'An <a> needs an href: link the parent item or render a <button>',
    all('a:not([href])').filter((el) => !(el.getAttribute('role') === 'button' && el.getAttribute('tabindex') === '0')));
  const named = (el) => !!((el.getAttribute('aria-label') || '').trim()
    || (el.getAttribute('aria-labelledby') || '').split(/\s+/).some((id) => (document.getElementById(id)?.textContent || '').trim())
    || (el.getAttribute('title') || '').trim());
  add('role-img-misplaced', 'role="img" belongs on the <svg>, <img> or <canvas> itself, or on a childless element with an accessible name',
    all('[role="img"]').filter((el) => !['svg', 'img', 'canvas'].includes(el.localName) && !(el.childElementCount === 0 && named(el))));
  const mains = all('main, [role="main"]').filter((el) => !el.hidden);
  add('multiple-main', 'A page has at most one main landmark', mains.length > 1 ? mains : []);
  add('nested-nav', 'A navigation landmark must not sit inside another (header blocks use a div wrapper and let core render the nav)',
    all(NAV).filter((el) => el.parentElement && el.parentElement.closest(NAV)));
  add('nav-too-few-links', 'A navigation landmark needs at least 2 links: merge small menus into one nav with role=group columns',
    all(NAV).filter((el) => el.querySelectorAll('a[href]').length < 2));

  // Headings hidden from everyone (display:none, aria-hidden) are not part of the outline anyone hears.
  const shown = (el) => !el.closest('[aria-hidden="true"]') && (typeof el.checkVisibility !== 'function' || el.checkVisibility());
  const level = (el) => (/^h[1-6]$/.test(el.localName) ? Number(el.localName[1]) : Number(el.getAttribute('aria-level')) || 2);
  const headings = all('h1, h2, h3, h4, h5, h6, [role="heading"]').filter(shown);
  for (let i = 1; i < headings.length; i++) {
    const a = level(headings[i - 1]);
    const b = level(headings[i]);
    if (b > a + 1) out.push({ id: 'heading-skip', impact: 'serious', help: `Heading levels must not skip: h${a} is followed by h${b}`, helpUrl: null, nodes: [node(headings[i - 1]), node(headings[i])] });
  }
  return out;
}

const trimPattern = (p) => ({ ...p, nodes: p.nodes.map((n) => ({ target: n.target, html: snippet(n.html) })) });

export async function runAxe(page, { tags = A11Y_TAGS, blockingRules = BLOCKING_RULES, include = null } = {}) {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  let builder = new AxeBuilder({ page }).withTags(tags);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const flags = await page.evaluate(pageProbe, { task: 'resolve', include, groups: results.violations.map((v) => v.nodes.map((n) => n.target)) });
  results.violations.forEach((v, i) => v.nodes.forEach((n, j) => { if (flags[i][j]) Object.assign(n, flags[i][j]); }));
  return { ...filterViolations(results.violations, { blockingRules }), tagsUsed: [...tags] };
}

export async function patternChecks(page, { root = null } = {}) {
  const r = await page.evaluate(pageProbe, { task: 'patterns', root });
  if (r === null) throw fail('EANCHOR', `${root} is not on the page.`);
  return r.map(trimPattern);
}

export function mergeViewports(results) {
  const merged = new Map();
  const key = (v) => `${v.id}\u0000${JSON.stringify(v.nodes?.[0]?.target ?? null)}`;
  for (const r of results ?? []) {
    for (const list of ['blocking', 'other']) {
      for (const v of r[list] ?? []) {
        const k = key(v);
        const seen = merged.get(k);
        if (!seen) { merged.set(k, { list, v: { ...v, viewports: [r.name], nodes: [...(v.nodes ?? [])].slice(0, MAX_NODES) } }); continue; }
        if (!seen.v.viewports.includes(r.name)) seen.v.viewports.push(r.name);
        for (const n of v.nodes ?? []) {
          if (seen.v.nodes.length >= MAX_NODES) break;
          if (!seen.v.nodes.some((m) => JSON.stringify(m.target) === JSON.stringify(n.target))) seen.v.nodes.push(n);
        }
        if (list === 'blocking') seen.list = 'blocking';
      }
    }
  }
  const all = [...merged.values()];
  return {
    blocking: all.filter((x) => x.list === 'blocking').map((x) => x.v),
    other: all.filter((x) => x.list === 'other').map((x) => x.v),
    byViewport: (results ?? []).map((r) => ({
      name: r.name, width: r.width,
      blocking: [...new Set((r.blocking ?? []).map((v) => v.id))],
      other: [...new Set((r.other ?? []).map((v) => v.id))],
    })),
  };
}

// Widths as numbers or {name, width}; deduped by width, first name wins, order kept.
function viewports(widths) {
  const out = [];
  for (const w of [].concat(widths ?? [])) {
    const v = typeof w === 'number' ? { name: String(w), width: w } : { name: String(w?.name ?? w?.width), width: w?.width };
    if (!Number.isFinite(v.width) || v.width <= 0) throw fail('EINPUT', `a11y widths must be positive numbers (got ${JSON.stringify(w)}).`);
    if (!out.some((x) => x.width === v.width)) out.push(v);
  }
  if (!out.length) throw fail('EINPUT', 'a11y needs at least one width.');
  return out;
}

const defaultOpenPage = async () => (await import('./browser.mjs')).openPage;

// On a page already open at `url`: click the first same-site header link to another page, wait for the swap, check.
async function navigateAndCheck(page, { url, tags, blockingRules }) {
  if (!(await page.evaluate(pageProbe, { task: 'hasTaxi' }))) return { skipped: true, warning: NO_TAXI_WARNING };
  const link = await page.evaluate(pageProbe, { task: 'navLink' });
  if (!link) return { skipped: true, warning: NO_LINK_WARNING };
  const { countPageReady, isHardNavigation } = await import('./motion-check.mjs');
  const before = await countPageReady(page);
  const failed = (error) => ({ skipped: false, from: url, to: page.url(), blocking: [], other: [], patterns: [], ariaCurrent: null, error, pass: false });
  try {
    await page.locator('header a[href]').nth(link.index).click({ timeout: CLICK_TIMEOUT_MS });
    // Taxi swaps the view and dispatches proto:page-ready; when its fetch fails it falls back to a full load, whose new
    // document has no counter: then the page is checked once that load completes.
    await page.waitForFunction((k) => (typeof window.__pbReady === 'number' ? window.__pbReady > k : document.readyState === 'complete'), before, { timeout: NAV_READY_TIMEOUT_MS, polling: 50 });
  } catch (e) {
    if (e?.name === 'TimeoutError') return failed(`proto:page-ready was not dispatched within ${NAV_READY_TIMEOUT_MS}ms of clicking ${link.href}`);
    if (!isHardNavigation(e)) throw e;
    await page.waitForLoadState('load', { timeout: NAV_READY_TIMEOUT_MS }).catch(() => {});
  }
  const via = (await page.evaluate(() => typeof window.__pbReady === 'number')) ? 'taxi' : 'load';
  const axe = await runAxe(page, { tags, blockingRules });
  const patterns = await patternChecks(page);
  const ariaCurrent = await page.evaluate(pageProbe, { task: 'ariaCurrent' });
  return {
    skipped: false, from: url, to: page.url(), via,
    blocking: axe.blocking, other: axe.other, patterns, ariaCurrent,
    pass: axe.blocking.length === 0 && patterns.length === 0 && ariaCurrent.pass,
  };
}

export async function afterNavigation({ browser, openPage, url, width, tags = A11Y_TAGS, blockingRules = BLOCKING_RULES }) {
  const open = openPage ?? await defaultOpenPage();
  const { page, context } = await open(browser, { url, width });
  try {
    return await navigateAndCheck(page, { url, tags, blockingRules });
  } finally { await context.close().catch(() => {}); }
}

/**
 * The page-QA a11y object for one page. `diagnostics` (optional, filled in) receives `pageErrors` raised on the axe
 * pages and `status`, the HTTP status of the first load.
 */
export async function a11yForPage({ browser, openPage, url, widths, blockingRules = BLOCKING_RULES, navigation = true, tags = A11Y_TAGS, diagnostics = {} }) {
  const views = viewports(widths);
  const open = openPage ?? await defaultOpenPage();
  diagnostics.pageErrors ??= [];
  const a11y = { blocking: [], other: [], byViewport: [], patterns: [], afterNavigation: null, tagsUsed: [...tags] };
  try {
    const per = [];
    let taxi = false;
    for (const [i, v] of views.entries()) {
      const { page, context, errors, status } = await open(browser, { url, width: v.width });
      try {
        const r = await runAxe(page, { tags, blockingRules });
        per.push({ name: v.name, width: v.width, blocking: r.blocking, other: r.other });
        if (i === 0) {
          diagnostics.status = status;
          a11y.patterns = await patternChecks(page);
          taxi = await page.evaluate(pageProbe, { task: 'hasTaxi' });
        }
        diagnostics.pageErrors.push(...errors.page);
      } finally { await context.close().catch(() => {}); }
    }
    Object.assign(a11y, mergeViewports(per));
    // Without Taxi there is no page swap to check, and no reason to load the page once more to find that out.
    if (navigation) a11y.afterNavigation = taxi ? await afterNavigation({ browser, openPage: open, url, width: views[0].width, tags, blockingRules }) : { skipped: true, warning: NO_TAXI_WARNING };
  } catch (e) {
    a11y.error = String(e?.message ?? e);
    diagnostics.pageErrors.push(...(e?.pageErrors ?? []));
  }
  return a11y;
}

const ids = (list) => [...new Set((list ?? []).map((v) => v.id))].join(', ');

export function a11yBlockers(a11y) {
  const out = [];
  if (!a11y) return out;
  if (a11y.error !== undefined) out.push(`axe did not run: ${a11y.error}`);
  if ((a11y.blocking ?? []).length) out.push(`blocking a11y violations: ${ids(a11y.blocking)}`);
  if ((a11y.patterns ?? []).length) out.push(`a11y pattern failures: ${ids(a11y.patterns)}`);
  const n = a11y.afterNavigation;
  if (n && n.skipped !== true) {
    const at = `after navigating to ${n.to ?? '?'}`;
    if (n.error !== undefined) out.push(`post-navigation pass failed: ${n.error}`);
    if ((n.blocking ?? []).length) out.push(`blocking a11y violations ${at}: ${ids(n.blocking)}`);
    if ((n.patterns ?? []).length) out.push(`a11y pattern failures ${at}: ${ids(n.patterns)}`);
    const c = n.ariaCurrent;
    if (c && c.pass === false) {
      const parts = [['missing on', c.missing], ['stale on', c.stale], ['set on hash links', c.hash]].filter(([, l]) => (l ?? []).length).map(([w, l]) => `${w} ${l.join(', ')}`);
      out.push(`aria-current="page" wrong ${at}: ${parts.join('; ')}`);
    }
  }
  return out;
}

export async function checkSectionA11y({ url, anchor, width = 1440, browser, blockingRules = BLOCKING_RULES }) {
  if (typeof anchor !== 'string' || !ANCHOR.test(anchor)) throw fail('EANCHOR', `Invalid anchor ${JSON.stringify(anchor)}: must match /^[A-Za-z][A-Za-z0-9_-]*$/`);
  let parsed = null;
  try { parsed = new URL(url); } catch { /* reported below */ }
  if (typeof url !== 'string' || !parsed || !/^https?:$/.test(parsed.protocol)) throw fail('EINPUT', `url must be an http(s) URL, got ${JSON.stringify(url)}`);
  if (!Number.isFinite(width) || width <= 0) throw fail('EINPUT', `width must be a positive number (got ${JSON.stringify(width)})`);
  const { launchBrowser, openPage } = await import('./browser.mjs');
  const own = !browser;
  const b = browser ?? await launchBrowser();
  try {
    const { page, context } = await openPage(b, { url, width });
    try {
      const selector = `#${anchor}`;
      if (!(await page.locator(selector).count())) throw fail('EANCHOR', `${selector} is not on the page ${url}.`);
      const axe = await runAxe(page, { include: selector, blockingRules });
      const patterns = await patternChecks(page, { root: selector });
      return { url, anchor, width, blocking: axe.blocking, other: axe.other, patterns, pass: axe.blocking.length === 0 && patterns.length === 0 };
    } finally { await context.close().catch(() => {}); }
  } finally { if (own) await b.close().catch(() => {}); }
}

const USAGE = 'Usage: node a11y.mjs check-section <url> <anchor> [--width N]\n';

async function main(argv) {
  const [cmd, ...rest] = argv;
  let width = 1440;
  const i = rest.indexOf('--width');
  if (i >= 0) {
    width = Number(rest[i + 1]);
    rest.splice(i, 2);
  }
  if (cmd !== 'check-section' || rest.length !== 2 || rest.some((a) => a.startsWith('--')) || !Number.isInteger(width) || width <= 0) {
    process.stderr.write(USAGE);
    process.exit(64);
  }
  const r = await checkSectionA11y({ url: rest[0], anchor: rest[1], width });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (!r.pass) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
