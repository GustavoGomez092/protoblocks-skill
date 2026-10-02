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
const statusError = (message) => Object.assign(new Error(message), { code: 'ESTATUS' });
const acceptError = (message) => Object.assign(new Error(message), { code: 'EACCEPT' });

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
const missingAnchorWarning = (bp, anchor) => `${bp}: #${anchor} is not on the page; its masks are applied at the design position only.`;
// pageQa warnings that make a failing comparison untrustworthy, so its differences cannot be accepted.
const TRUNCATED_WARNING = /the screenshot may be truncated/;
const MISSING_ANCHOR_WARNING = /: #([A-Za-z0-9_-]+) is not on the page; its masks are applied at the design position only\.$/;

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

// Document height and the top of each anchor relative to the top of body (CSS px; the page shot is of body), measured in
// one page load (null: anchor not found).
async function measurePage(browser, openPage, url, width, anchors = []) {
  const { page, context } = await openPage(browser, { url, width, scale: 1 });
  try {
    return await page.evaluate((ids) => {
      const bodyTop = document.body ? document.body.getBoundingClientRect().top : 0;
      return {
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        tops: Object.fromEntries(ids.map((id) => { const el = document.getElementById(id); return [id, el ? el.getBoundingClientRect().top - bodyTop : null]; })),
      };
    }, anchors);
  } finally { await context.close().catch(() => {}); }
}

/**
 * Section masks at the position the section actually renders: `tops` are the anchors' tops below the top of body (the
 * page shot) in CSS px and `pxPerCss` the frame's design pixels per CSS px (the render is resized to the design width
 * before the diff).
 */
export function renderMasks(sectionMasks = [], tops = {}, pxPerCss = 1) {
  const masks = [];
  const missing = [];
  for (const sm of sectionMasks) {
    const top = tops[sm.anchor];
    if (typeof top !== 'number') { missing.push(sm.anchor); continue; }
    for (const m of sm.masks) masks.push({ x: m.x, y: Math.round(top * pxPerCss) + m.y, w: m.w, h: m.h });
  }
  return { masks, missing };
}

export async function pageQa({ url, frames, qa = {}, outDir, browser, warnings = [] }) {
  validateInput({ url, frames, outDir });
  outDir = path.resolve(outDir);
  const pageMismatchMax = qa.pageMismatchMax ?? 0.12;
  const heightDeltaMax = qa.heightDeltaMax ?? 0.03;
  fs.mkdirSync(outDir, { recursive: true });
  const own = !browser;
  let b = browser;
  const result = { url, pass: false, breakpoints: [], a11y: { blocking: [], other: [] }, pageErrors: [], warnings: [...warnings] };
  try {
    const { launchBrowser, openPage } = await import('./browser.mjs');
    const { shoot } = await import('./shoot.mjs');
    const { diffImages } = await import('./diff.mjs');
    b ??= await launchBrowser();
    for (const f of frames) {
      const requested = f.scale ?? 1;
      const sectionMasks = f.sectionMasks ?? [];
      const { height: documentHeightPx, tops } = await measurePage(b, openPage, url, f.width, sectionMasks.map((x) => x.anchor));
      const atRender = renderMasks(sectionMasks, tops, f.pxPerCss ?? 1);
      for (const a of atRender.missing) result.warnings.push(missingAnchorWarning(f.breakpoint, a));
      // Union: the design position (where the design has the masked content) and the render position (where the page has it).
      const masks = [...(f.masks ?? []), ...atRender.masks];
      const { scaleUsed, warning } = fitScale(documentHeightPx, requested);
      if (warning) result.warnings.push(`${f.breakpoint}: ${warning}`);
      const render = path.join(outDir, `${f.breakpoint}-page.png`);
      // The body is the target so that broken or stalled images anywhere on the page count as in-target errors; header and
      // footer are descendants of body and stay in the shot.
      const shot = await shoot({ url, selector: 'body', width: f.width, scale: scaleUsed, out: render, browser: b });
      result.pageErrors.push(...shot.pageErrors);
      const d = await diffImages({ design: f.image, render, out: path.join(outDir, `${f.breakpoint}-page-composite.png`), masks });
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
        masksApplied: masks.length,
        masks,
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

/**
 * Why a failing page-QA result cannot be accepted by the developer: only design differences (a breakpoint over the
 * mismatch or height threshold) can be; errors, a11y, broken media, HTTP errors, full masks, missing breakpoints, a
 * truncated screenshot and masks whose anchor is not on the page cannot.
 */
export function acceptBlockers(r, frames = []) {
  const out = [];
  if (r.error !== undefined) out.push(`the run failed: ${r.error}`);
  if (r.a11y?.error !== undefined) out.push(`axe did not run: ${r.a11y.error}`);
  if ((r.a11y?.blocking ?? []).length) out.push(`blocking a11y violations: ${r.a11y.blocking.map((v) => v.id).join(', ')}`);
  if ((r.pageErrors ?? []).length) out.push(`page errors: ${r.pageErrors.length}`);
  for (const w of r.warnings ?? []) {
    if (TRUNCATED_WARNING.test(w)) out.push(`the screenshot may be truncated (${w}): shorten the page or compare it in parts`);
    const m = String(w).match(MISSING_ANCHOR_WARNING);
    if (m) out.push(`masks of #${m[1]} could not be placed (the anchor is not on the page): fix the anchor, then re-run page QA`);
  }
  const bps = Array.isArray(r.breakpoints) ? r.breakpoints : [];
  for (const f of frames) if (!bps.some((b) => b?.name === f.breakpoint)) out.push(`breakpoint ${f.breakpoint} was not checked`);
  for (const b of bps) {
    if (b?.status >= 400) out.push(`${b.name}: HTTP ${b.status}`);
    if (b?.fullyMasked === true) out.push(`${b.name}: fully masked, nothing compared`);
    if ((b?.imageErrors ?? []).length) out.push(`${b.name}: broken images`);
  }
  if (!out.length && !bps.some((b) => b?.pass === false)) out.push('no breakpoint failed on a design difference, so there is nothing to accept');
  return out;
}

/**
 * Records a page-QA result for a page in status `building` whose sections are all done or skipped. The result must be
 * of the page's url. A pass sets the page `seo`. `accepted` (the developer's note) records a failing result whose only
 * failures are design differences as accepted: `pageQa.accepted`, `page.notes.pageQa`, status `seo`.
 */
export async function recordPageQa(themeDir, slug, file, { accepted } = {}) {
  if (accepted !== undefined && (typeof accepted !== 'string' || !accepted.trim())) throw inputError('--accepted needs a non-empty note (what the developer accepted).');
  const abs = path.resolve(file);
  let r;
  try { r = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { throw inputError(`Cannot read page-qa result ${abs}: ${e.message}`); }
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw inputError(`Page-qa result ${abs} is not a JSON object.`);
  const pass = r.pass === true;
  let status;
  let acceptedOut = false;
  updateState(themeDir, (s) => {
    const p = s.pages.find((x) => x.slug === slug);
    if (!p) throw pageError(`No page "${slug}" in state.`);
    if (p.status !== 'building') throw statusError(`Page "${slug}" is "${p.status}", not "building": page QA is recorded once, after its sections are done.`);
    const open = p.sections.filter((x) => x.status !== 'done' && x.status !== 'skipped');
    if (open.length) throw statusError(`Page "${slug}" has sections that are not done or skipped (${open.map((x) => `${x.n}: ${x.status}`).join(', ')}); finish them, then re-run page QA.`);
    if (!p.url || r.url !== p.url) throw inputError(`${abs} checked ${JSON.stringify(r.url ?? null)}, but page "${slug}" is ${JSON.stringify(p.url ?? null)}; re-run page-qa.mjs run for this page.`);
    const at = new Date().toISOString();
    if (pass || accepted === undefined) {
      p.pageQa = { pass, file: abs, at };
    } else {
      const blockers = acceptBlockers(r, p.design?.frames ?? []);
      if (blockers.length) throw acceptError(`Only design differences can be accepted; fix these first:\n- ${blockers.join('\n- ')}`);
      const note = accepted.trim();
      p.pageQa = { pass: false, accepted: true, note, by: 'developer', file: abs, at };
      const notes = p.notes && typeof p.notes === 'object' ? p.notes : (typeof p.notes === 'string' ? { text: p.notes } : {});
      p.notes = { ...notes, pageQa: `accepted by developer: ${note}` };
      acceptedOut = true;
    }
    if (pass || acceptedOut) p.status = 'seo';
    status = p.status;
  });
  return acceptedOut ? { pass, accepted: true, status } : { pass, status };
}

/**
 * Section masks (crop pixels, `sections[j].masks.<bp>`) translated into the page frame with the section's crop range
 * (`sections[j].ranges.<bp>`, frame pixels): `masks` at the design position, and per anchor the section-relative masks
 * that pageQa also places at the render position. A section with masks but no range is reported in `warnings`.
 */
export function sectionMasksFor(page, bp, warnings = []) {
  const masks = [];
  const sectionMasks = [];
  for (const sec of [...(page.sections ?? [])].sort((a, b) => a.n - b.n)) {
    const list = sec.masks?.[bp];
    if (!Array.isArray(list) || !list.length || sec.status === 'skipped') continue;
    const r = sec.ranges?.[bp];
    if (!r || !Number.isFinite(r.y0) || !Number.isFinite(r.y1)) {
      warnings.push(`${bp}: section ${sec.n} (#${sec.anchor}) has masks but no crop range in state; they are not applied to page QA (re-run intake.mjs crop to record ranges).`);
      continue;
    }
    const rel = [];
    for (const m of list) {
      const h = Math.min(m.h, r.y1 - r.y0 - m.y);
      if (!(h > 0) || !(m.w > 0)) continue;
      masks.push({ x: m.x, y: r.y0 + m.y, w: m.w, h });
      rel.push({ x: m.x, y: m.y, w: m.w, h });
    }
    if (rel.length) sectionMasks.push({ anchor: sec.anchor, masks: rel });
  }
  return { masks, sectionMasks };
}

// Inputs for `run`, taken from state. Design frames already use {breakpoint,width,scale,image}; scale defaults to 1 and a
// relative image path resolves against <themeDir>/.protoblocks (where the state's "artifacts/…" paths live).
export function buildInputs(themeDir, slug) {
  const s = loadState(themeDir);
  const p = s.pages.find((x) => x.slug === slug);
  if (!p) throw pageError(`No page "${slug}" in state.`);
  if (!p.url) throw pageError(`Page "${slug}" has no url.`);
  const warnings = [];
  const frames = (p.design?.frames ?? []).map((f) => {
    const frame = {
      breakpoint: f.breakpoint,
      width: f.width,
      scale: f.scale ?? 1,
      image: typeof f.image === 'string' ? path.resolve(stateDir(themeDir), f.image) : f.image,
    };
    const { masks, sectionMasks } = sectionMasksFor(p, f.breakpoint, warnings);
    if (masks.length) {
      // Design pixels per CSS px: the render is resized to the design width before the diff.
      Object.assign(frame, { masks, sectionMasks, pxPerCss: (f.pixelWidth ?? f.width * (f.scale ?? 1)) / f.width });
    }
    return frame;
  });
  return { url: p.url, frames, qa: s.site.qa ?? {}, outDir: path.join(stateDir(themeDir), 'artifacts', slug, 'page-qa'), warnings };
}

const USAGE = 'Usage: node page-qa.mjs run <themeDir> <slug> | record <themeDir> <slug> <page-qa.json> [--accepted "<note>"]\n';

async function main(argv) {
  const [cmd, themeDir, slug, file] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'run' && themeDir && slug && argv.length === 3) {
    const inputs = buildInputs(themeDir, slug);
    const r = await pageQa(inputs);
    out({ ...r, file: path.join(inputs.outDir, 'page-qa.json') });
    if (!r.pass) process.exit(1);
    return;
  }
  if (cmd === 'record') {
    const rest = argv.slice(1);
    const i = rest.indexOf('--accepted');
    let accepted;
    if (i >= 0) {
      accepted = rest[i + 1];
      if (accepted === undefined || accepted.startsWith('--') || !accepted.trim()) throw inputError('--accepted needs a non-empty note (what the developer accepted).');
      rest.splice(i, 2);
    }
    if (rest.length === 3 && !rest.some((a) => a.startsWith('--'))) return out(await recordPageQa(rest[0], rest[1], rest[2], { accepted }));
  }
  process.stderr.write(USAGE);
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
