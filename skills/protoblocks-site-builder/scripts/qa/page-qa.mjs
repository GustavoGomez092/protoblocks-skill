#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, stateDir } from '../lib/state.mjs';

// Axe nodes count only when they sit in page content: main/header/footer or a section anchor (#pb-s…). Tag names are
// matched as whole compound-selector heads so ".domain a", "#footer-widget a" and ".site-header a" do not qualify.
const TAG_SCOPE = /(?:^|[\s>+~(])(?:main|header|footer)(?![\w-])/;
const ANCHOR_SCOPE = /#pb-s/;
// Document-level rules (html-has-lang, document-title, meta-viewport...) report the root elements themselves.
const DOCUMENT_SCOPE = /^(?:html|body)$/;
const BLOCKING = ['serious', 'critical'];
// Chromium cannot paint a surface much taller than 16384 device px; stay below it.
const MAX_SURFACE_PX = 16000;
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

const inputError = (message) => Object.assign(new Error(message), { code: 'EINPUT' });
const pageError = (message) => Object.assign(new Error(message), { code: 'ENOPAGE' });

export function filterViolations(violations) {
  // pageQa resolves each node in the page and sets node.inScope; the selector-string match is the fallback for nodes it
  // could not resolve (iframe/shadow targets) and for results that were not produced in a page.
  const inScope = (node) => (typeof node?.inScope === 'boolean' ? node.inScope : [].concat(node?.target ?? []).flat(Infinity).some((t) => DOCUMENT_SCOPE.test(String(t)) || TAG_SCOPE.test(String(t)) || ANCHOR_SCOPE.test(String(t))));
  const kept = (violations ?? []).map((v) => ({ ...v, nodes: (v.nodes ?? []).filter(inScope) })).filter((v) => v.nodes.length);
  return { blocking: kept.filter((v) => BLOCKING.includes(v.impact)), other: kept.filter((v) => !BLOCKING.includes(v.impact)) };
}

// Largest integer scale >= 1 (never above the requested one) whose surface fits; scale 1 is used with a warning when even that is too tall.
export function fitScale(cssHeight, scale) {
  if (cssHeight * scale <= MAX_SURFACE_PX) return { scaleUsed: scale, warning: null };
  const fit = Math.floor(MAX_SURFACE_PX / cssHeight);
  if (fit >= 1) return { scaleUsed: Math.min(fit, Math.floor(scale) || 1), warning: null };
  return { scaleUsed: 1, warning: `Page is ${cssHeight}px tall: even at scale 1 it exceeds the ${MAX_SURFACE_PX}px surface limit; the screenshot may be truncated.` };
}

function validateInput({ url, frames, outDir }) {
  if (typeof url !== 'string' || !url.trim()) throw inputError('pageQa needs a non-empty url.');
  if (typeof outDir !== 'string' || !outDir.trim()) throw inputError('pageQa needs a non-empty outDir.');
  if (!Array.isArray(frames) || frames.length === 0) throw inputError('pageQa needs at least one design frame; a page with no frames cannot be verified.');
  const seen = new Set();
  frames.forEach((f, i) => {
    const at = `frames[${i}]`;
    if (typeof f?.breakpoint !== 'string' || !SAFE_NAME.test(f.breakpoint)) throw inputError(`${at}.breakpoint must match [A-Za-z0-9_-]+ (got ${JSON.stringify(f?.breakpoint)}).`);
    if (seen.has(f.breakpoint)) throw inputError(`${at}.breakpoint "${f.breakpoint}" is duplicated.`);
    seen.add(f.breakpoint);
    if (!Number.isFinite(f.width) || f.width <= 0) throw inputError(`${at}.width must be a positive number (got ${JSON.stringify(f.width)}).`);
    if (f.scale !== undefined && (!Number.isFinite(f.scale) || f.scale <= 0)) throw inputError(`${at}.scale must be a positive number (got ${JSON.stringify(f.scale)}).`);
    let ok = false;
    try { ok = typeof f.image === 'string' && fs.statSync(f.image).isFile(); } catch { /* not found */ }
    if (!ok) throw inputError(`${at}.image is not an existing file (${JSON.stringify(f.image)}).`);
  });
}

async function documentHeight(browser, openPage, url, width) {
  const { page, context } = await openPage(browser, { url, width, scale: 1 });
  try {
    return await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
  } finally { await context.close().catch(() => {}); }
}

export async function pageQa({ url, frames, qa = {}, outDir, browser }) {
  validateInput({ url, frames, outDir });
  outDir = path.resolve(outDir);
  const pageMismatchMax = qa.pageMismatchMax ?? 0.12;
  const heightDeltaMax = qa.heightDeltaMax ?? 0.03;
  fs.mkdirSync(outDir, { recursive: true });
  const own = !browser;
  let b = browser;
  const result = { url, pass: false, breakpoints: [], a11y: { blocking: [], other: [] }, pageErrors: [], warnings: [] };
  try {
    const { launchBrowser, openPage } = await import('./browser.mjs');
    const { shoot } = await import('./shoot.mjs');
    const { diffImages } = await import('./diff.mjs');
    b ??= await launchBrowser();
    for (const f of frames) {
      const requested = f.scale ?? 1;
      const documentHeightPx = await documentHeight(b, openPage, url, f.width);
      const { scaleUsed, warning } = fitScale(documentHeightPx, requested);
      if (warning) result.warnings.push(`${f.breakpoint}: ${warning}`);
      const render = path.join(outDir, `${f.breakpoint}-page.png`);
      // The body is the target so that broken or stalled images anywhere on the page count as in-target errors; header and
      // footer are descendants of body and stay in the shot.
      const shot = await shoot({ url, selector: 'body', width: f.width, scale: scaleUsed, out: render, browser: b });
      result.pageErrors.push(...shot.pageErrors);
      const d = await diffImages({ design: f.image, render, out: path.join(outDir, `${f.breakpoint}-page-composite.png`), masks: f.masks ?? [] });
      const httpOk = !(shot.status >= 400);
      result.breakpoints.push({
        name: f.breakpoint,
        status: shot.status,
        scaleRequested: requested,
        scaleUsed,
        documentHeight: documentHeightPx,
        mismatch: d.mismatch,
        heightDelta: d.heightDelta,
        fullyMasked: d.fullyMasked === true,
        imageErrors: shot.imageErrors,
        pass: httpOk && d.fullyMasked !== true && shot.imageErrors.length === 0 && d.mismatch <= pageMismatchMax && d.heightDelta <= heightDeltaMax,
        composite: d.composite,
      });
    }
    try {
      const { default: AxeBuilder } = await import('@axe-core/playwright');
      const { page, context, errors } = await openPage(b, { url, width: frames[0].width });
      try {
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        // axe targets are the shortest unique selector (just "img"), so resolve the real DOM position of every node.
        const flags = await page.evaluate((groups) => groups.map((targets) => targets.map((t) => {
          if (!Array.isArray(t) || t.length !== 1 || typeof t[0] !== 'string') return null;
          try { const el = document.querySelector(t[0]); return el ? el === document.documentElement || el === document.body || !!el.closest('main, header, footer, [id^="pb-s"]') : null; } catch { return null; }
        })), results.violations.map((v) => v.nodes.map((n) => n.target)));
        results.violations.forEach((v, i) => v.nodes.forEach((n, j) => { if (flags[i][j] !== null) n.inScope = flags[i][j]; }));
        result.a11y = filterViolations(results.violations);
        result.pageErrors.push(...errors.page);
      } finally { await context.close().catch(() => {}); }
    } catch (e) {
      result.a11y = { blocking: [], other: [], error: String(e?.message ?? e) };
      result.pageErrors.push(...(e?.pageErrors ?? []));
    }
    result.pass = result.breakpoints.length === frames.length && result.breakpoints.every((x) => x.pass)
      && result.a11y.error === undefined && result.a11y.blocking.length === 0 && result.pageErrors.length === 0;
  } catch (e) {
    result.pass = false;
    result.error = String(e?.message ?? e);
    throw e;
  } finally {
    try { fs.writeFileSync(path.join(outDir, 'page-qa.json'), `${JSON.stringify(result, null, 2)}\n`); } catch { /* keep the original error */ }
    if (own && b) await b.close().catch(() => {});
  }
  return result;
}

export async function recordPageQa(themeDir, slug, file) {
  const abs = path.resolve(file);
  let r;
  try { r = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { throw inputError(`Cannot read page-qa result ${abs}: ${e.message}`); }
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw inputError(`Page-qa result ${abs} is not a JSON object.`);
  const pass = r.pass === true;
  let status;
  updateState(themeDir, (s) => {
    const p = s.pages.find((x) => x.slug === slug);
    if (!p) throw pageError(`No page "${slug}" in state.`);
    p.pageQa = { pass, file: abs, at: new Date().toISOString() };
    if (pass) p.status = 'seo';
    status = p.status;
  });
  return { pass, status };
}

// Inputs for `run`, taken from state. Design frames already use {breakpoint,width,scale,image}; scale defaults to 1 and a
// relative image path resolves against <themeDir>/.protoblocks (where the state's "artifacts/…" paths live).
export function buildInputs(themeDir, slug) {
  const s = loadState(themeDir);
  const p = s.pages.find((x) => x.slug === slug);
  if (!p) throw pageError(`No page "${slug}" in state.`);
  if (!p.url) throw pageError(`Page "${slug}" has no url.`);
  const frames = (p.design?.frames ?? []).map((f) => ({
    breakpoint: f.breakpoint,
    width: f.width,
    scale: f.scale ?? 1,
    image: typeof f.image === 'string' ? path.resolve(stateDir(themeDir), f.image) : f.image,
  }));
  return { url: p.url, frames, qa: s.site.qa ?? {}, outDir: path.join(stateDir(themeDir), 'artifacts', slug, 'page-qa') };
}

async function main(argv) {
  const [cmd, themeDir, slug, file] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'run' && themeDir && slug) {
    const inputs = buildInputs(themeDir, slug);
    const r = await pageQa(inputs);
    out({ ...r, file: path.join(inputs.outDir, 'page-qa.json') });
    if (!r.pass) process.exit(1);
    return;
  }
  if (cmd === 'record' && themeDir && slug && file) return out(await recordPageQa(themeDir, slug, file));
  process.stderr.write('Usage: node page-qa.mjs run <themeDir> <slug> | record <themeDir> <slug> <page-qa.json>\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
