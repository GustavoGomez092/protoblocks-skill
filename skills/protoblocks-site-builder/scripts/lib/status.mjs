#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, statePath } from './state.mjs';
import { PART_ANCHORS } from './plan.mjs';

const CLOSED = new Set(['done', 'skipped']);
// Sections being worked on. `planned` is not open work: it has never been built.
export const OPEN = new Set(['building', 'verifying', 'animating']);
const PART_ANCHOR_SET = new Set(Object.values(PART_ANCHORS));
// Every action nextAction can return (enforced at runtime). The orchestrator SKILL.md has one action-table row per
// entry and references/pipeline.md one section per entry (tested).
export const ACTIONS = Object.freeze(['setup', 'breakdown', 'build-page', 'section-build', 'section-verify', 'section-animate', 'move-parts', 'page-qa', 'seo', 'ask-more-pages']);

const byN = (a, b) => a.n - b.n;

/** Sections of a page that are open work (building, verifying, animating), lowest n first. */
export const openSections = (page) => [...(page.sections ?? [])].sort(byN).filter((s) => OPEN.has(s.status));

/**
 * Setup steps whose result is not in state yet (tokens, menus, the header part), in setup order. Navigation is done
 * when a menu is recorded, or when the design has none (`site.navigation = {menus: {}, none: true}`). The header part
 * is done when `site.parts.header` is recorded, or when a page's `pb-header` section is already rendered by the part
 * (`inPart`; builds from before `site.parts` was recorded).
 */
export function setupGaps(state) {
  const gaps = [];
  const nav = state.site.navigation;
  const menus = nav?.menus;
  const hasMenu = menus != null && typeof menus === 'object' && Object.keys(menus).length > 0;
  const noNavigation = nav?.none === true && menus != null && typeof menus === 'object' && Object.keys(menus).length === 0;
  const headerInPart = (state.pages ?? []).some((p) => (p.sections ?? []).some((s) => s.anchor === PART_ANCHORS.header && s.inPart === true));
  if (state.site.tokens == null) gaps.push('site.tokens (tokens.mjs apply)');
  if (!hasMenu && !noNavigation) gaps.push('site.navigation.menus (navigation.mjs upsert; a design without navigation: site.navigation.none: true with menus {})');
  if (state.site.parts?.header == null && !headerInPart) gaps.push('site.parts.header (parts.mjs write)');
  return gaps;
}

/** Header/footer sections of `page` that passed as page sections but are not in the template parts yet. */
export function partsToMove(state, page) {
  return [...page.sections].sort(byN).filter((s) => PART_ANCHOR_SET.has(s.anchor) && s.status === 'done' && s.inPart !== true
    && !state.pages.some((o) => o.slug !== page.slug && o.sections.some((x) => x.anchor === s.anchor && x.inPart === true)));
}

/** A page's QA counts as passed when it passed, or the developer accepted its design differences. */
export const pageQaPassed = (page) => page.pageQa?.pass === true || page.pageQa?.accepted === true;

const pageQaWhy = (page) => (page.pageQa?.pass !== true && page.pageQa?.accepted === true ? 'page QA differences accepted by the developer' : 'page QA passed');

function sectionAction(page, s, why) {
  const action = s.status === 'verifying' ? 'section-verify' : s.status === 'animating' ? 'section-animate' : 'section-build';
  return { action, page: page.slug, section: s.n, why: why ?? `section ${s.n} is ${s.status}` };
}

function decide(state) {
  if (!state) return { action: 'setup', why: 'no build state yet' };
  const gaps = setupGaps(state);
  if (gaps.length) return { action: 'setup', why: `setup incomplete: missing ${gaps.join(', ')}` };
  // A finished page with a reopened section (re-verification after a shared-block edit, a page-QA fix) comes first.
  const page = state.pages.find((p) => p.status !== 'done' || openSections(p).length);
  if (!page) return { action: 'ask-more-pages', why: state.pages.length ? 'every page is done' : 'no pages yet' };
  if (page.status === 'planning') {
    if (page.plan?.approvedAt && !page.sections.length) return { action: 'breakdown', page: page.slug, why: 'approved plan has no sections' };
    return page.plan?.approvedAt
      ? { action: 'build-page', page: page.slug, why: 'plan approved; start building' }
      : { action: 'breakdown', page: page.slug, why: 'section plan not approved yet' };
  }
  if (page.status === 'seo' || page.status === 'done') {
    const reopened = openSections(page)[0];
    if (reopened) return sectionAction(page, reopened, `section ${reopened.n} was reopened (${reopened.status}) on a page in status ${page.status}`);
    return { action: 'seo', page: page.slug, why: pageQaWhy(page) };
  }
  if (!page.sections.length) return { action: 'breakdown', page: page.slug, why: 'building page has no sections' };
  const open = [...page.sections].sort(byN).find((s) => !CLOSED.has(s.status));
  if (open) return sectionAction(page, open);
  const unmoved = partsToMove(state, page);
  if (unmoved.length) {
    return { action: 'move-parts', page: page.slug, sections: unmoved.map((s) => s.n), why: `header/footer (${unmoved.map((s) => `#${s.anchor}`).join(', ')}) passed as sections but are not in the template parts yet` };
  }
  return pageQaPassed(page)
    ? { action: 'seo', page: page.slug, why: pageQaWhy(page) }
    : { action: 'page-qa', page: page.slug, why: 'all sections closed' };
}

/** Throws EACTION unless `next.action` is one of ACTIONS (so the docs, which list ACTIONS, cannot drift). */
export function assertAction(next) {
  if (!ACTIONS.includes(next?.action)) throw Object.assign(new Error(`nextAction returned "${next?.action}", which is not in ACTIONS`), { code: 'EACTION' });
  return next;
}

export const nextAction = (state) => assertAction(decide(state));

export function summarize(state) {
  return {
    site: { url: state.site.url, theme: state.site.theme?.slug ?? null },
    pages: state.pages.map((p) => ({
      slug: p.slug,
      status: p.status,
      sections: [...p.sections].sort(byN).map((s) => {
        const qa = (s.qa ?? []).filter((q) => q?.iteration != null);
        const iterations = new Set(qa.map((q) => q.iteration)).size;
        const last = qa.at(-1);
        return { n: s.n, label: s.label ?? null, block: s.block ?? null, status: s.status, iterations, lastPass: last ? last.pass === true : null };
      }),
    })),
    next: nextAction(state),
  };
}

/** Theme folders under <publicPath>/wp-content/themes that hold a build state, sorted. */
export function findThemes(publicPath) {
  const themes = path.join(publicPath, 'wp-content', 'themes');
  if (!fs.existsSync(themes) || !fs.statSync(themes).isDirectory()) {
    throw Object.assign(new Error(`${themes} is not a directory (pass the WordPress root, preflight's publicPath)`), { code: 'ENOTHEME' });
  }
  return fs.readdirSync(themes).sort().map((d) => path.join(themes, d)).filter((d) => fs.existsSync(statePath(d)));
}

/** `status.mjs <themeDir>` or `status.mjs --root <publicPath>`. */
export function statusOf(argv) {
  if (argv[0] === '--root') {
    const found = findThemes(argv[1]);
    if (found.length === 0) return { themeDir: null, next: nextAction(null) };
    if (found.length === 1) return { themeDir: found[0], ...summarize(loadState(found[0])) };
    const themes = found.map((themeDir) => {
      try { const s = loadState(themeDir); return { themeDir, url: s.site.url, pages: s.pages.map((p) => p.slug) }; } catch (e) { return { themeDir, error: `${e.code ? `[${e.code}] ` : ''}${e.message}` }; }
    });
    return { themes, next: null, why: 'several themes have a build state: ask the developer which one, then run status.mjs with that theme folder' };
  }
  const [themeDir] = argv;
  if (!fs.existsSync(themeDir) || !fs.statSync(themeDir).isDirectory()) throw Object.assign(new Error(`${themeDir} is not a directory`), { code: 'ENOTHEME' });
  return fs.existsSync(statePath(themeDir)) ? { themeDir, ...summarize(loadState(themeDir)) } : { themeDir, next: nextAction(null) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  if (argv.length < 1 || argv.length > 2 || (argv[0] === '--root') !== (argv.length === 2) || argv[0]?.startsWith('--') && argv[0] !== '--root') {
    process.stderr.write('Usage: node status.mjs <themeDir> | --root <publicPath>\n'); process.exit(64);
  }
  try {
    process.stdout.write(`${JSON.stringify(statusOf(argv), null, 2)}\n`);
  } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
