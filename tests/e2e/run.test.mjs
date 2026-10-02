// End-to-end scripted run of the full pipeline: setup (fork, tokens, menu, parts) -> intake -> plan -> gates -> page
// build -> per-section numeric QA -> motion -> header/footer part move (adopt, rebuild, re-verify) -> page QA -> Yoast
// SEO -> done -> ask-more-pages, driving the script surface only (no LLM judgement), on the Local test site.
//
// Two passes: WordPress' global styles disabled (Proto-Blocks' "Disable WP Global Styles" on) and on. The theme shell
// fixes come from the builder's managed pb-shell.css only (the e2e blocks carry no page-shell workarounds).
//
// SAFETY (the developer's real site). Run it only through the site lock (it skips unless PB_SITE_LOCK=1, which the
// lock script exports; tests/README.md):
//   tests/pb-site-test.sh <worktree> test:e2e
// - Run manifest: tests/.tmp/site-run-<hex>.json is written before the first change and updated after each (fork slug,
//   page/menu/attachment names and ids, option snapshots, the Tailwind cache copy, the Yoast snapshot). SIGTERM/SIGINT
//   restore from it synchronously; a manifest left behind makes the next run refuse to start (tests/recover.mjs).
// - Global styles: the pass sets proto_blocks_tailwind.disable_global_styles only when it differs; the whole option is
//   snapshotted and restored exactly (and checked afterwards).
// - Options: setupSite runs only when the plugins are active and the options ensurePlugins would write are already
//   in their target state (else skip). Theme-switch options (theme_mods_<original>, sidebars_widgets,
//   theme_switched, current_theme) and those setup options are snapshotted and restored; theme_mods_<fork> is deleted.
// - Theme: a unique fork pb-e2e-<hex>. The original stylesheet is recorded first (and in tests/.tmp/original-theme.txt
//   for crash recovery); `finally` re-activates it, then deletes only that exact fork folder (directly inside the
//   themes dir, basename = the unique slug, fork marker or build.json present, original theme active again).
// - Page: unique slug pb-e2e-home-<hex>, deleted by its own id (its post meta goes with it). Attachments: only the ones
//   this run imported (`reused: false`), by id.
// - Yoast options: snapshotted with tests/integration/yoast-options.php and restored exactly; a crash snapshot left
//   by an earlier run makes this test refuse to start. No `organization` leaf is ever passed, so applySeo never writes
//   Yoast's site-wide options.
// - Tailwind: gates recompile Proto-Blocks' Tailwind cache for the active (e2e) theme; its option and cache files are
//   snapshotted and put back byte for byte.
// - Navigation: exactly one menu, key e2e-<hex> (post pb-nav-e2e-<hex>), deleted by its own id in `finally`. The
//   developer's menu (wp_navigation 15) is only read.
// - Parts: `parts.mjs write` into the throwaway fork only (files, deleted with the fork). `remove-override` is never
//   called; the developer's template parts 154/159 are only read (checked unchanged afterwards).
// - Never touches the developer's theme checkout or plugins (both checked before/after).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC, TEST_SITE, SITE_URL, ORIGINAL_THEME, testWp, restoreTheme, siteSkipReason, setupWriteReason, SETUP_OPTION_NAMES,
  themeOptionNames, snapshotOptions as snapshotWpOptions, restoreOptions as restoreWpOptions, dropThemeMods, leakedThemeMods,
  snapshotTailwind, restoreTailwind,
} from '../integration/helpers.mjs';
import { haveQaDeps, QA_DIR } from '../qa/helpers.mjs';
import { createRun, leftoverReason, onInterrupt, recoverOnSignal, rawOption as rawOpt } from '../site-run.mjs';
import { setupSite } from '../../skills/protoblocks-site-builder/scripts/lib/setup-site.mjs';
import { forkMarker } from '../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';
import { installMotion, recordMotion, runtimePresets } from '../../skills/protoblocks-site-builder/scripts/lib/motion.mjs';
import { runApply } from '../../skills/protoblocks-site-builder/scripts/lib/tokens.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { runGates, gateInputFromState } from '../../skills/protoblocks-site-builder/scripts/lib/gates.mjs';
import { addFrame, cropSections, artifactsDir } from '../../skills/protoblocks-site-builder/scripts/lib/intake.mjs';
import { recordPlan } from '../../skills/protoblocks-site-builder/scripts/lib/plan.mjs';
import { buildPage } from '../../skills/protoblocks-site-builder/scripts/lib/page.mjs';
import { prepareCheck, recordVerdict } from '../../skills/protoblocks-site-builder/scripts/lib/qa-input.mjs';
import { applySeo, recordAudit } from '../../skills/protoblocks-site-builder/scripts/lib/seo.mjs';
import { nextAction } from '../../skills/protoblocks-site-builder/scripts/lib/status.mjs';
import { loadState, updateState, statePath } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { buildInputs, recordPageQa } from '../../skills/protoblocks-site-builder/scripts/qa/page-qa.mjs';
import { partMarkup, writePart, markupFromArgs, adoptParts, listOverrides } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';
import { refreshMenus } from '../../skills/protoblocks-site-builder/scripts/lib/navigation.mjs';
import { recordUse } from '../../skills/protoblocks-site-builder/scripts/lib/library.mjs';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TMP = path.join(REPO, 'tests', '.tmp');
const BLOCKS = path.join(HERE, 'blocks');
const BLOCK_NAMES = ['site-header', 'hero-split', 'feature-grid', 'cta-band', 'site-footer'];
const THEMES = PUBLIC ? path.join(PUBLIC, 'wp-content', 'themes') : '';
const DEV_THEME = THEMES ? path.join(THEMES, 'proto-blocks-theme') : '';
const OPTIONS_PHP = path.join(REPO, 'tests', 'integration', 'yoast-options.php');
// Same crash-recovery file as tests/integration/yoast.test.mjs: one snapshot at a time, never overwritten.
const SNAPSHOT_FILE = path.join(TMP, 'yoast-options-snapshot.json');
const RESTORE_COMMAND = `${path.join(TMP, 'wp-test-site')} eval-file ${OPTIONS_PHP} restore ${SNAPSHOT_FILE}`;
// The developer's header/footer template parts and navigation menu: only read (checked unchanged afterwards).
const PARTS = (process.env.PB_E2E_PARTS ?? '154,159').split(',').map(Number);
const MENU_ID = Number(process.env.PB_E2E_MENU ?? 15);
const NAV_CLI = path.join(REPO, 'skills', 'protoblocks-site-builder', 'scripts', 'lib', 'navigation.mjs');
// The pipeline must stop and clean up well inside the 10-minute window the lock script runs in.
const BUDGET_MS = 420000;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SEO = (ogFile) => ({
  focusKeyword: { value: 'solar installation', inferred: false },
  title: { value: 'Solar Installation Made Simple | Northwind Solar', inferred: false },
  description: { value: 'Northwind Solar plans, permits and completes your solar installation in six weeks for one fixed price. Book a free site visit today.', inferred: false },
  ogImage: { value: { file: ogFile }, inferred: false },
});

// Section n -> block, label, part, attrs, inner (raw block markup for the inner-blocks navigation slot).
const navLink = (label, url) => `<!-- wp:navigation-link {"label":"${label}","url":"${url}","kind":"custom"} /-->`;
const nav = (links) => [`<!-- wp:navigation {"overlayMenu":"never"} -->\n${links.map(([l, u]) => navLink(l, u)).join('\n')}\n<!-- /wp:navigation -->`];
const SECTIONS = [
  { n: 1, block: 'site-header', label: 'header', part: 'header', anchor: 'pb-header',
    attrs: { logo: 'Northwind Solar' }, inner: (menuId) => [`<!-- wp:navigation {"ref":${menuId},"overlayMenu":"never"} /-->`] },
  { n: 2, block: 'hero-split', label: 'hero', anchor: 'pb-s2',
    attrs: { heading: 'Solar installation without the guesswork', text: 'Northwind designs, permits and finishes your solar installation in six weeks, for one fixed price agreed up front.', cta: { url: '#contact', text: 'Get a free quote', target: '', rel: '' } } },
  { n: 3, block: 'feature-grid', label: 'features', anchor: 'pb-s3',
    attrs: { heading: 'Why homeowners choose Northwind', cards: [
      { id: 'card-1', title: 'One fixed price', text: 'The quote you sign is the price you pay. Permits, panels and wiring are all included.' },
      { id: 'card-2', title: 'Six-week schedule', text: 'Survey, design, permits and install are planned in one timeline you can follow online.' },
      { id: 'card-3', title: '25-year warranty', text: 'Panels, inverter and workmanship are covered for 25 years by one local team.' },
    ] } },
  { n: 4, block: 'cta-band', label: 'cta', anchor: 'pb-s4',
    attrs: { heading: 'See what your roof can produce', text: 'Book a free site visit and get a written estimate within two days.', cta: { url: '/contact/', text: 'Book a site visit', target: '', rel: '' } } },
  { n: 5, block: 'site-footer', label: 'footer', part: 'footer', anchor: 'pb-footer',
    attrs: { copyright: 'Copyright 2026 Northwind Solar' }, inner: nav([['Privacy', '/privacy/'], ['Terms', '/terms/']]) },
];
const HERO_PRESETS = ['split-lines', 'fade-up'];
// The one menu this run creates (the header's navigation, referenced by `ref`); the footer's links are inline blocks.
const MENU_SPEC = (hex) => ({ title: `E2E ${hex}`, items: [{ label: 'Features', url: '#features' }, { label: 'Pricing', url: '#pricing' }, { label: 'Contact', url: '#contact' }] });
// The design's tokens (setup Step 2). System fonts only: no `google` weights, so `tokens.mjs apply` drops the fork's
// Google Fonts @import (the page then needs no third-party request to load or reach network idle).
const TOKENS = {
  colors: { ink: '#111827', navy: '#0f172a', sun: '#fef3c7', accent: '#1d4ed8', mist: '#f1f5f9', slate: '#475569' },
  fonts: { sans: { family: 'Arial', fallback: 'Helvetica, sans-serif' } },
  radii: { card: '12px', button: '8px' },
  spacing: { container: '1200px', section: '96px' },
};

// A fresh connection per request: Local's nginx closes idle keep-alive sockets (see yoast.test.mjs).
const fetchHtml = (url) => new Promise((resolve, reject) => {
  (url.startsWith('https:') ? https : http).get(url, { agent: false, rejectUnauthorized: false }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

// Serves tests/e2e (design.html) on 127.0.0.1, like tests/qa/helpers.mjs serveFixtures.
function serveDesign() {
  const server = http.createServer((req, res) => {
    const p = path.join(HERE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(HERE + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }),
  })));
}

// Files (path, size, mtime) of the developer's theme checkout, .git excluded (reading git status could touch its index).
function treeFingerprint(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const rows = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const st = fs.lstatSync(p); rows.push(`${path.relative(dir, p)}|${st.size}|${st.mtimeMs}`); }
    }
  };
  walk(dir);
  return { files: rows.length, hash: sha(rows.join('\n')) };
}

function siteFingerprint(wp) {
  const field = (id, f) => wp.check(['post', 'get', String(id), `--field=${f}`]);
  return {
    stylesheet: wp.check(['option', 'get', 'stylesheet']).trim(),
    template: wp.check(['option', 'get', 'template']).trim(),
    plugins: wp.check(['plugin', 'list', '--fields=name,status,version', '--format=json']).trim(),
    parts: PARTS.map((id) => ({ id, name: field(id, 'post_name').trim(), modified: field(id, 'post_modified_gmt').trim(), content: sha(field(id, 'post_content')) })),
    templateParts: wp.check(['post', 'list', '--post_type=wp_template_part', '--post_status=any', '--fields=ID,post_name,post_status,post_modified_gmt', '--format=json']).trim(),
    menus: wp.check(['menu', 'list', '--fields=term_id,name,slug,locations,count', '--format=json']).trim(),
    navigations: wp.check(['post', 'list', '--post_type=wp_navigation', '--post_status=any', '--fields=ID,post_name,post_status,post_modified_gmt', '--format=json']).trim(),
    menu15: { modified: field(MENU_ID, 'post_modified_gmt').trim(), content: sha(field(MENU_ID, 'post_content')) },
    devTheme: treeFingerprint(DEV_THEME),
  };
}

// The theme_mods_* rows (name and a hash of the value), for the before/after comparison.
const themeModsList = (wp) => JSON.parse(wp.check(['option', 'list', '--search=theme_mods_*', '--fields=option_name,option_value', '--format=json']))
  .map((o) => ({ name: o.option_name, value: sha(String(o.option_value)) })).sort((a, b) => a.name.localeCompare(b.name));

const leftovers = (wp) => ({
  themes: fs.readdirSync(THEMES).filter((n) => n.startsWith('pb-e2e-')),
  menus: JSON.parse(wp.check(['post', 'list', '--post_type=wp_navigation', '--post_status=any', '--fields=ID,post_name', '--format=json']))
    .filter((p) => String(p.post_name).startsWith('pb-nav-e2e-')),
  posts: JSON.parse(wp.check(['post', 'list', '--post_type=page,attachment', '--post_status=any', '--fields=ID,post_type,post_name', '--format=json']))
    .filter((p) => String(p.post_name).startsWith('pb-e2e')),
});

const snapshotOptions = (wp) => wp.evalFile(OPTIONS_PHP, ['snapshot']);
function restoreOptions(wp, snapshot) {
  const f = path.join(TMP, `yoast-options-restore-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(f, JSON.stringify(snapshot));
  try { return wp.evalFile(OPTIONS_PHP, ['restore', f]); } finally { fs.rmSync(f, { force: true }); }
}
const rawOption = (wp, name) => wp.run(['option', 'get', name, '--format=json']).stdout.trim();

// Proto-Blocks' "Disable WP Global Styles" (Tailwind/Manager.php: proto_blocks_tailwind['disable_global_styles']).
const GS_KEY = 'disable_global_styles';
const globalStylesDisabled = (wp) => {
  const raw = rawOpt(wp, 'proto_blocks_tailwind');
  const v = raw === null ? null : JSON.parse(raw);
  return v !== null && typeof v === 'object' && v[GS_KEY] === true;
};
/** Turns WordPress' global styles on or off through the Proto-Blocks setting; writes only when it differs. */
function setGlobalStyles(wp, on) {
  if (globalStylesDisabled(wp) === !on) return false;
  wp.check(['eval', `$o = get_option('proto_blocks_tailwind', []); if (!is_array($o)) { $o = []; } $o['${GS_KEY}'] = ${on ? 'false' : 'true'}; update_option('proto_blocks_tailwind', $o);`]);
  assert.equal(globalStylesDisabled(wp), !on, 'the global-styles setting took effect');
  return true;
}

// The verdict a scripted (no-LLM) visual QA writes: copied field by field from check-section's result.json, so
// recordVerdict's cross-check against result.json/input.json sees exactly the measured numbers.
function verdictFromResult(result) {
  return {
    anchor: result.anchor,
    pass: result.numericPass === true,
    numericPass: result.numericPass === true,
    breakpoints: result.results.map((r) => ({
      name: r.breakpoint,
      mode: r.mode,
      numericPass: r.numericPass === true,
      ...(r.mode === 'diff' ? { mismatch: r.mismatch, heightDelta: r.heightDelta } : {}),
      ...(r.widthDelta !== undefined ? { widthDelta: r.widthDelta } : {}),
    })),
    discrepancies: [],
    notes: 'scripted e2e verdict: pass = check-section numericPass (no visual judgement)',
  };
}

function skipReason() {
  if (siteSkipReason()) return siteSkipReason(); // first: without the lock nothing may talk to the site
  if (!haveQaDeps) return 'QA deps missing: run npm install in skills/protoblocks-site-builder/scripts/qa';
  if (!SITE_URL) return 'WP-CLI could not read siteurl (is the Local site running?)';
  if (!ORIGINAL_THEME || ORIGINAL_THEME.startsWith('pb-')) return 'the original theme is unknown (site left on a pb-* theme; set PB_TEST_THEME)';
  return '';
}

async function e2ePass(t, { globalStyles }) {
  const why = skipReason();
  if (why) { t.skip(why); return; }
  // An interrupted earlier run may have left the site changed: refuse until tests/recover.mjs restored it.
  const left = leftoverReason();
  if (left) throw new Error(left);
  const wp = testWp();
  // setupSite (ensurePlugins) installs/activates plugins and writes options unless they are already in their target
  // state; this test never lets it write: skip instead.
  const setupWhy = setupWriteReason(wp);
  if (setupWhy) { t.skip(setupWhy); return; }
  try {
    const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
    await (await launchBrowser()).close();
  } catch (e) { t.skip(`Playwright Chromium is not usable (npx playwright install chromium): ${String(e.message).split('\n')[0]}`); return; }

  // Refuse to start over a crash snapshot: the Yoast options may still be modified by an earlier run.
  fs.mkdirSync(TMP, { recursive: true });
  if (fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(`${SNAPSHOT_FILE} exists: a previous run crashed before restoring the Yoast options.\nRestore them, then delete the file:\n  ${RESTORE_COMMAND}`);
  }
  const before = siteFingerprint(wp);
  assert.equal(before.stylesheet, ORIGINAL_THEME, 'the active theme is the recorded original');
  const leftoversBefore = leftovers(wp);
  const themeModsBefore = themeModsList(wp);

  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const { findCuts } = await import(path.join(QA_DIR, 'segment.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const { checkSection } = await import(path.join(QA_DIR, 'check-section.mjs'));
  const { motionCheck } = await import(path.join(QA_DIR, 'motion-check.mjs'));
  const { pageQa } = await import(path.join(QA_DIR, 'page-qa.mjs'));
  const { ogImage } = await import(path.join(QA_DIR, 'og-image.mjs'));
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));

  const hex = crypto.randomBytes(4).toString('hex');
  const themeSlug = `pb-e2e-${hex}`;
  const pageSlug = `pb-e2e-home-${hex}`;
  const themeDir = path.join(THEMES, themeSlug);
  const work = path.join(TMP, `e2e-${hex}`);
  fs.mkdirSync(work, { recursive: true });
  const t0 = Date.now();
  const budget = (step) => { if (Date.now() - t0 > BUDGET_MS) throw new Error(`e2e time budget (${BUDGET_MS} ms) exceeded before: ${step}`); };
  const report = { hex, themeSlug, pageSlug, work, startedAt: new Date().toISOString(), steps: {}, sections: [], motion: [], deviations: [] };
  const say = (msg) => t.diagnostic(msg);
  report.timings = {};
  let lapAt = Date.now();
  const lap = (name) => { report.timings[name] = Date.now() - lapAt; lapAt = Date.now(); };

  // Every snapshot is taken before the Yoast crash file is written, so a crash file always means "options taken".
  const tailwindBefore = snapshotTailwind(wp);
  // Theme-switch, setup and plugin options; proto_blocks_tailwind holds the global-styles setting this pass may change.
  const wpOptionNames = [...themeOptionNames(), ...SETUP_OPTION_NAMES, 'proto_blocks_tailwind'];
  const wpOptionsBefore = snapshotWpOptions(wp, wpOptionNames);
  const globalStylesDisabledBefore = globalStylesDisabled(wp);
  const yoastBefore = snapshotOptions(wp);
  const yoastRawBefore = { wpseo_titles: rawOption(wp, 'wpseo_titles'), wpseo_social: rawOption(wp, 'wpseo_social') };
  // The run manifest, before the first change: everything this pass may create or change, by exact name.
  const run = createRun({ kind: 'e2e', pass: globalStyles ? 'global-styles-on' : 'global-styles-off', site: TEST_SITE, publicPath: PUBLIC, wrapper: path.join(TMP, 'wp-test-site') });
  run.update((d) => {
    d.originalTheme = before.stylesheet;
    d.options = { ...wpOptionsBefore };
    d.yoast = { snapshotFile: SNAPSHOT_FILE };
    d.forks = [{ slug: themeSlug }];
    d.posts = [{ type: 'page', name: pageSlug }, { type: 'wp_navigation', name: `pb-nav-e2e-${hex}` }, { type: 'attachment', name: `pb-e2e-og-${hex}` }];
  }).setTailwind(tailwindBefore);
  const offSignals = onInterrupt((sig) => recoverOnSignal(wp, run, sig));
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(yoastBefore, null, 2));
  report.globalStyles = { pass: globalStyles ? 'on' : 'off', disabledBefore: globalStylesDisabledBefore };

  let err;
  let pageId = null;
  let menuId = null;
  const ownedMedia = [];
  let server;
  try {
    // 0. This pass's WordPress global styles (Proto-Blocks setting; restored with the option snapshot).
    report.globalStyles.changed = setGlobalStyles(wp, globalStyles);
    // The design: block CSS is copied verbatim into design.html.
    const designHtml = fs.readFileSync(path.join(HERE, 'design.html'), 'utf8');
    for (const b of BLOCK_NAMES) assert.ok(designHtml.includes(fs.readFileSync(path.join(BLOCKS, b, 'style.css'), 'utf8')), `design.html carries ${b}/style.css verbatim`);

    // 1. Render the design at 1440 (full page).
    server = await serveDesign();
    const designPng = path.join(work, 'design-desktop.png');
    const ds = await shoot({ url: `${server.url}/design.html`, width: 1440, fullPage: true, out: designPng });
    assert.deepEqual(ds.pageErrors, []);
    await server.close(); server = null;
    lap('design');

    // 2. Setup: fork + activate the unique theme, install the motion runtime.
    budget('setup');
    fs.writeFileSync(path.join(TMP, 'original-theme.txt'), before.stylesheet); // crash recovery for helpers.mjs
    const setup = await setupSite({ cwd: PUBLIC, site: TEST_SITE, name: `PB E2E ${hex}`, slug: themeSlug });
    report.steps.setup = { plugins: setup.plugins, theme: setup.theme };
    assert.equal(setup.theme.slug, themeSlug);
    assert.equal(setup.theme.reused, false);
    assert.equal(fs.realpathSync(setup.theme.themeDir), fs.realpathSync(themeDir));
    assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), themeSlug);
    assert.ok(setup.plugins.plugins.every((p) => p.action === 'ok'), `plugins untouched: ${JSON.stringify(setup.plugins.plugins)}`);
    assert.deepEqual(setup.plugins.options, [], 'setupSite changed no site option');
    lap('setup');
    const tokens = runApply(themeDir, TOKENS, { compile: () => wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['compile']) });
    report.steps.tokens = { written: tokens.written, warnings: tokens.warnings ?? [] };
    assert.ok(!fs.readFileSync(path.join(themeDir, 'style.css'), 'utf8').includes('fonts.googleapis.com'), 'no web font import left in the fork');
    assert.equal(nextAction(loadState(themeDir)).action, 'setup', 'setup is unfinished without menus and parts');
    // Setup Step 3: one menu, through the CLI (it records site.navigation.menus.<key> in state).
    const menuKey = `e2e-${hex}`;
    const specFile = path.join(work, 'menu-spec.json');
    fs.writeFileSync(specFile, JSON.stringify(MENU_SPEC(hex)));
    const navRun = spawnSync(process.execPath, [NAV_CLI, 'upsert', themeDir, menuKey, specFile], { encoding: 'utf8', timeout: 120000 });
    assert.equal(navRun.status, 0, `navigation.mjs upsert: ${navRun.stderr}`);
    const menu = JSON.parse(navRun.stdout);
    menuId = menu.id;
    run.setPostId(`pb-nav-e2e-${hex}`, 'wp_navigation', menuId);
    report.steps.menu = { key: menuKey, id: menu.id, created: menu.created, pending: menu.pending };
    assert.equal(menu.created, true);
    assert.deepEqual(menu.pending, []);
    assert.equal(wp.check(['post', 'get', String(menuId), '--field=post_name']).trim(), `pb-nav-${menuKey}`);
    assert.equal(loadState(themeDir).site.navigation.menus[menuKey].id, menuId);
    // Setup Step 4: header/footer parts in the fork (no Site Editor copies exist for a fresh fork; nothing is removed).
    assert.deepEqual(listOverrides(wp, themeSlug), []);
    writePart(themeDir, 'header', partMarkup({ block: 'proto-blocks/site-header', navRef: menuId }));
    writePart(themeDir, 'footer', partMarkup({ block: 'proto-blocks/site-footer' }));
    assert.equal(nextAction(loadState(themeDir)).action, 'ask-more-pages', 'setup complete, no pages yet');
    const motionInstall = installMotion(themeDir);
    assert.ok(motionInstall.copied.includes('assets/js/pb-motion.js'));

    // 3. The section blocks into the fork (the Build step's files).
    for (const b of BLOCK_NAMES) fs.cpSync(path.join(BLOCKS, b), path.join(themeDir, 'proto-blocks', b), { recursive: true });

    // 4. Intake: the design frame, background bands from findCuts, crops (header/footer get the part anchors).
    budget('intake');
    const frame = addFrame(themeDir, pageSlug, 'desktop', designPng, { title: 'Northwind Solar' });
    assert.equal(frame.width, 1440);
    assert.equal(frame.scale, 1);
    const cuts = findCuts(await loadRaw(frame.image));
    report.steps.bands = cuts.bands;
    assert.equal(cuts.bands.length, 5, `5 background bands: ${JSON.stringify(cuts.bands)}`);
    assert.ok(cuts.bands.every((b) => Array.isArray(b.bg)), 'solid bands only (the design has no photos)');
    const ranges = { desktop: cuts.bands.map((b, i) => ({ n: i + 1, y0: b.y0, y1: b.y1, ...(SECTIONS[i].part ? { part: SECTIONS[i].part } : {}) })) };
    const crops = await cropSections(themeDir, pageSlug, ranges);
    assert.deepEqual(crops.map((c) => c.anchor), SECTIONS.map((s) => s.anchor));
    lap('intake');

    // 5. Plan gate: nothing builds before approval; then the plan, then the section data (the Build step).
    assert.equal(nextAction(loadState(themeDir)).action, 'breakdown');
    assert.throws(() => buildPage(wp, themeDir, pageSlug), (e) => e.code === 'ENOPLAN');
    const plan = recordPlan(themeDir, { page: pageSlug, sections: SECTIONS.map((s) => ({ n: s.n, label: s.label, decision: 'new', block: s.block, ...(s.part ? { part: s.part } : {}) })) });
    assert.deepEqual(plan.sections.map((s) => s.anchor), SECTIONS.map((s) => s.anchor));
    assert.deepEqual(nextAction(loadState(themeDir)), { action: 'section-build', page: pageSlug, section: 1, why: 'section 1 is planned' });
    updateState(themeDir, (s) => {
      const page = s.pages.find((p) => p.slug === pageSlug);
      for (const def of SECTIONS) {
        const sec = page.sections.find((x) => x.n === def.n);
        sec.attrs = def.attrs;
        if (def.inner) sec.inner = typeof def.inner === 'function' ? def.inner(menuId) : def.inner;
        sec.status = 'building';
      }
    });
    for (const def of SECTIONS) recordUse(themeDir, def.block, pageSlug, { purpose: def.label });

    // 6. Gates for every section, attrs from state (they travel as a payload file).
    budget('gates');
    report.steps.gates = {};
    for (const def of SECTIONS) {
      const g = runGates(wp, { ...gateInputFromState(loadState(themeDir), pageSlug, def.n), themeDir });
      report.steps.gates[def.block] = g.steps.map((s) => ({ id: s.id, ok: s.ok }));
      assert.ok(g.ok, `gates ${def.block}: ${JSON.stringify(g.steps)}`);
    }
    lap('gates');

    // 7. Build the page.
    budget('build');
    const built = buildPage(wp, themeDir, pageSlug);
    pageId = built.postId;
    run.setPostId(pageSlug, 'page', pageId);
    report.steps.build = { postId: built.postId, url: built.url, created: built.created, warnings: built.warnings };
    assert.equal(built.created, true);
    assert.deepEqual(built.warnings, []);
    const pageUrl = loadState(themeDir).pages.find((p) => p.slug === pageSlug).url;
    const html = (await fetchHtml(pageUrl)).body;
    for (const def of SECTIONS) assert.equal(html.split(`id="${def.anchor}"`).length - 1, 1, `#${def.anchor} renders once`);
    assert.equal((html.match(/<(header|footer) class="wp-block-template-part/g) ?? []).length, 2, 'the setup-time header and footer parts render (no anchor yet)');
    assert.equal(html.includes("id='global-styles-inline-css'") || html.includes('id="global-styles-inline-css"'), globalStyles, `WordPress global styles are ${globalStyles ? 'printed' : 'not printed'} in this pass`);
    assert.match(html, /<link[^>]+id=['"]pb-shell-css['"][^>]+\/assets\/css\/pb-shell\.css/, 'the managed page-shell stylesheet is enqueued');
    assert.match(html, /data-pb-motion="split-lines"[^>]*data-proto-animate="manual"/);
    assert.match(html, /data-pb-motion="fade-up"[^>]*data-proto-animate="manual"[^>]*data-pb-delay="0.15"/);
    lap('build');

    // 8. Per-section numeric QA: prepare -> check-section -> verdict built from result.json -> record.
    const verify = async (def, phase) => {
      budget(`verify section ${def.n} (${phase})`);
      const { input } = prepareCheck(themeDir, pageSlug, def.n);
      const result = await checkSection(JSON.parse(fs.readFileSync(input, 'utf8')));
      const verdictFile = path.join(path.dirname(input), 'verdict.json');
      fs.writeFileSync(verdictFile, `${JSON.stringify(verdictFromResult(result), null, 2)}\n`);
      const rec = recordVerdict(themeDir, pageSlug, def.n, verdictFile);
      const row = {
        phase, n: def.n, anchor: def.anchor, block: def.block, iteration: rec.iteration, numericPass: result.numericPass, status: rec.status,
        breakpoints: result.results.map((r) => ({ name: r.breakpoint, mode: r.mode, numericPass: r.numericPass, mismatch: r.mismatch ?? null, heightDelta: r.heightDelta ?? null, widthDelta: r.widthDelta ?? null, sanityIssues: r.issues ?? undefined, error: r.error })),
        composite: result.results.find((r) => r.mode === 'diff')?.composite ?? null,
      };
      report.sections.push(row);
      say(`${phase} section ${def.n} ${def.anchor}: ${JSON.stringify(row.breakpoints.map((b) => [b.name, b.mismatch, b.heightDelta, b.widthDelta, b.numericPass]))}`);
      lap(`verify-${phase}-${def.n}`);
      return row;
    };
    for (const def of SECTIONS) await verify(def, 'section');
    const failed = report.sections.filter((r) => r.numericPass !== true);
    assert.deepEqual(failed.map((r) => r.anchor), [], `numeric QA failed: ${JSON.stringify(failed, null, 2)}`);
    assert.ok(report.sections.every((r) => r.status === 'animating'));
    assert.equal(nextAction(loadState(themeDir)).action, 'section-animate');

    // 9. Motion: a real motion check per section; the hero carries presets, the others none (header/footer: no motion).
    assert.ok(HERO_PRESETS.every((p) => runtimePresets().includes(p)));
    for (const def of SECTIONS) {
      budget(`motion section ${def.n}`);
      const outDir = path.join(artifactsDir(themeDir), pageSlug, def.anchor, 'motion');
      const m = await motionCheck({ url: pageUrl, anchor: def.anchor, width: 1440, outDir });
      report.motion.push({ n: def.n, anchor: def.anchor, pass: m.pass, settledMismatch: m.settledMismatch, settledHeightDelta: m.settledHeightDelta, cls: m.cls, clsBaseline: m.clsBaseline, clsPage: m.clsPage, unsettled: m.unsettled, pageErrors: m.pageErrors, taxi: m.taxi });
      say(`motion ${def.anchor}: pass=${m.pass} settled=${m.settledMismatch} cls=${m.cls} taxi=${JSON.stringify(m.taxi)}`);
      assert.equal(m.pass, true, `motion check ${def.anchor}: ${JSON.stringify(report.motion.at(-1))}`);
      const r = recordMotion(themeDir, pageSlug, def.n, { presets: def.n === 2 ? HERO_PRESETS : [], checkFile: path.join(outDir, 'motion-check.json') });
      assert.deepEqual(r, { pass: true, attempts: 1, capReached: false, status: 'done' });
      lap(`motion-${def.n}`);
    }

    // 10. Move header and footer into the template parts (header-footer.md steps 1-8): part markup from state with the
    //     anchor, write, adopt, rebuild, re-verify header, footer and the first content section on their anchors.
    budget('move parts');
    assert.deepEqual(nextAction(loadState(themeDir)), { action: 'move-parts', page: pageSlug, sections: [1, 5], why: 'header/footer (#pb-header, #pb-footer) passed as sections but are not in the template parts yet' });
    assert.deepEqual(listOverrides(wp, themeSlug), []);
    for (const [part, n] of [['header', 1], ['footer', 5]]) {
      const markup = markupFromArgs([themeDir, '--from-state', pageSlug, String(n)]);
      assert.match(markup, new RegExp(`"anchor":"pb-${part}"`));
      writePart(themeDir, part, markup);
    }
    const adopted = adoptParts(themeDir, pageSlug);
    report.steps.adopt = adopted;
    assert.deepEqual(adopted, { page: pageSlug, moved: [{ n: 1, anchor: 'pb-header', status: 'building' }, { n: 5, anchor: 'pb-footer', status: 'building' }], reverify: 2 });
    assert.deepEqual(nextAction(loadState(themeDir)), { action: 'section-build', page: pageSlug, section: 1, why: 'section 1 is building' });
    for (const n of [1, 5]) recordUse(themeDir, SECTIONS[n - 1].block, pageSlug); // the inPart resume row: library record, build, verify
    const rebuilt = buildPage(wp, themeDir, pageSlug);
    report.steps.rebuild = { postId: rebuilt.postId, created: rebuilt.created, warnings: rebuilt.warnings, backupFile: rebuilt.backupFile };
    assert.equal(rebuilt.postId, pageId);
    assert.equal(rebuilt.created, false);
    assert.deepEqual(rebuilt.warnings, []);
    const html2 = (await fetchHtml(pageUrl)).body;
    for (const def of SECTIONS) assert.equal(html2.split(`id="${def.anchor}"`).length - 1, 1, `#${def.anchor} renders once after the move`);
    assert.ok(html2.indexOf('id="pb-header"') < html2.indexOf('<main'), 'the header renders from its part, above <main>');
    assert.ok(html2.indexOf('id="pb-footer"') > html2.indexOf('</main>'), 'the footer renders from its part, below </main>');
    assert.ok(!wp.check(['post', 'get', String(pageId), '--field=post_content']).includes('site-header'), 'the page content no longer holds the header');
    for (const n of [1, 2, 5]) {
      const row = await verify(SECTIONS[n - 1], 'after-move');
      assert.equal(row.numericPass, true, `re-verification of #${row.anchor} after the move: ${JSON.stringify(row, null, 2)}`);
      assert.equal(row.status, 'done', 'a re-verified section returns to done');
      // Rendered by the template parts, the header and footer still span the viewport (pb-shell.css).
      if (n !== 2) for (const b of row.breakpoints) assert.equal(b.widthDelta ?? 0, 0, `#${row.anchor} ${b.name} widthDelta after the move`);
    }
    assert.deepEqual(refreshMenus(wp, themeDir), { refreshed: [], menus: {} }, 'no pending menu links');
    const moved = loadState(themeDir).pages.find((p) => p.slug === pageSlug).sections;
    assert.deepEqual(moved.map((x) => [x.n, x.status, x.inPart === true]), [[1, 'done', true], [2, 'done', false], [3, 'done', false], [4, 'done', false], [5, 'done', true]]);
    assert.equal(nextAction(loadState(themeDir)).action, 'page-qa');

    // 11. Page QA against the full design frame (frames from state).
    budget('page qa');
    const inputs = buildInputs(themeDir, pageSlug);
    const pq = await pageQa(inputs);
    report.pageQa = { pass: pq.pass, breakpoints: pq.breakpoints.map(({ composite, ...b }) => b), a11y: { blocking: pq.a11y.blocking.map((v) => v.id), other: pq.a11y.other.map((v) => `${v.id} (${v.impact})`), error: pq.a11y.error }, pageErrors: pq.pageErrors, warnings: pq.warnings };
    say(`page qa: ${JSON.stringify(report.pageQa)}`);
    assert.equal(pq.breakpoints[0].pass, true, `page QA desktop: ${JSON.stringify(report.pageQa)}`);
    assert.equal(pq.pass, true, `page QA: ${JSON.stringify(report.pageQa)}`);
    assert.deepEqual(await recordPageQa(themeDir, pageSlug, path.join(inputs.outDir, 'page-qa.json')), { pass: true, status: 'seo' });
    lap('page-qa');
    assert.equal(nextAction(loadState(themeDir)).action, 'seo');

    // 12. SEO: OG image from the hero, apply (first apply on a fresh page; no organization leaf), audit, record.
    budget('seo');
    const ogFile = path.join(work, `pb-e2e-og-${hex}.png`);
    const og = await ogImage({ url: pageUrl, selector: '#pb-s2', out: ogFile });
    assert.equal(og.width, 1200);
    assert.equal(og.height, 630);
    const seo = SEO(ogFile);
    const applied = applySeo(wp, themeDir, pageSlug, seo, { index: false });
    for (const m of applied.media ?? []) {
      ownedMedia.push(m);
      if (!m.reused) run.setPostId(`pb-e2e-og-${hex}`, 'attachment', m.id);
    }
    report.steps.seoApply = { index: applied.index, jsonld: applied.jsonld, media: applied.media, warnings: applied.warnings ?? [], organization: applied.organization ?? null };
    assert.equal(applied.index, 'skipped');
    assert.equal(applied.media.length, 1);
    const auditFile = path.join(work, 'seo-audit.json');
    const audit = await seoAudit({ url: pageUrl, focusKeyword: seo.focusKeyword.value, out: auditFile });
    report.seoAudit = { pass: audit.pass, checks: audit.checks };
    const fails = audit.checks.filter((c) => c.status === 'fail');
    say(`seo audit: pass=${audit.pass} warn=${JSON.stringify(audit.checks.filter((c) => c.status === 'warn'))}`);
    assert.deepEqual(fails, [], 'no failing SEO check');
    assert.deepEqual(recordAudit(themeDir, pageSlug, auditFile), { pass: true, status: 'done' });

    // 13. Done: the page is done and the next action asks for more pages.
    const final = loadState(themeDir);
    const page = final.pages.find((p) => p.slug === pageSlug);
    assert.equal(page.status, 'done');
    assert.ok(page.sections.every((s) => s.status === 'done'));
    assert.equal(nextAction(final).action, 'ask-more-pages');
    report.final = { pageStatus: page.status, next: nextAction(final) };
    lap('seo');
  } catch (e) {
    err = e;
  } finally {
    const problems = [];
    const step = (what, fn) => { try { return fn(); } catch (e) { problems.push(`${what}: ${e.message}`); return undefined; } };
    if (server) await server.close().catch(() => {});
    // Keep the run's state and artifacts for the report before the fork goes.
    step('copy artifacts', () => { if (fs.existsSync(statePath(themeDir))) fs.cpSync(path.join(themeDir, '.protoblocks'), path.join(work, 'protoblocks'), { recursive: true }); });
    step('restore theme', () => restoreTheme(wp));
    const activeAfter = step('read stylesheet', () => wp.check(['option', 'get', 'stylesheet']).trim());
    // The page: by the id the build returned, plus any page holding this run's unique slug (a build that died midway).
    step('delete page', () => {
      const ids = new Set(pageId ? [pageId] : []);
      for (const id of wp.check(['post', 'list', '--post_type=page', '--post_status=any', `--name=${pageSlug}`, '--format=ids']).trim().split(/\s+/).filter(Boolean)) ids.add(Number(id));
      for (const id of ids) {
        const name = wp.check(['post', 'get', String(id), '--field=post_name']).trim();
        if (name !== pageSlug) { problems.push(`page ${id} is "${name}", not ${pageSlug}: left in place`); continue; }
        wp.check(['post', 'delete', String(id), '--force']);
      }
    });
    // The menu: by the id upsert returned, plus any wp_navigation holding this run's unique slug.
    step('delete menu', () => {
      const slug = `pb-nav-e2e-${hex}`;
      const ids = new Set(menuId ? [menuId] : []);
      for (const id of wp.check(['post', 'list', '--post_type=wp_navigation', '--post_status=any', `--name=${slug}`, '--format=ids']).trim().split(/\s+/).filter(Boolean)) ids.add(Number(id));
      for (const id of ids) {
        if (id === MENU_ID) { problems.push(`refusing to delete menu ${MENU_ID}`); continue; }
        const name = wp.check(['post', 'get', String(id), '--field=post_name']).trim();
        const type = wp.check(['post', 'get', String(id), '--field=post_type']).trim();
        if (name !== slug || type !== 'wp_navigation') { problems.push(`post ${id} is ${type} "${name}", not ${slug}: left in place`); continue; }
        wp.check(['post', 'delete', String(id), '--force']);
      }
    });
    // Attachments: the ones applySeo reported (not reused), plus the OG image by its exact unique name in case
    // applySeo threw after the import (then it reported nothing).
    step('find og attachment', () => {
      const name = `pb-e2e-og-${hex}`;
      for (const id of wp.check(['post', 'list', '--post_type=attachment', '--post_status=any', `--name=${name}`, '--format=ids']).trim().split(/\s+/).filter(Boolean)) {
        if (wp.check(['post', 'get', id, '--field=post_name']).trim() !== name) continue;
        if (!ownedMedia.some((m) => m.id === Number(id))) ownedMedia.push({ id: Number(id), reused: false, found: 'by-name' });
      }
    });
    for (const m of ownedMedia) {
      if (m.reused) continue; // an existing attachment the dedupe reused is not ours
      step(`delete attachment ${m.id}`, () => {
        const type = wp.check(['post', 'get', String(m.id), '--field=post_type']).trim();
        if (type !== 'attachment') { problems.push(`post ${m.id} is a ${type}, not an attachment: left in place`); return; }
        wp.check(['post', 'delete', String(m.id), '--force']);
      });
    }
    step('delete theme fork', () => {
      if (!fs.existsSync(themeDir)) return;
      const real = fs.realpathSync(themeDir);
      const style = path.join(real, 'style.css');
      const deletable = activeAfter === before.stylesheet
        && !fs.lstatSync(themeDir).isSymbolicLink()
        && path.dirname(real) === fs.realpathSync(THEMES)
        && path.basename(real) === themeSlug && /^pb-e2e-[0-9a-f]{8}$/.test(themeSlug)
        && ((fs.existsSync(style) && forkMarker(fs.readFileSync(style, 'utf8'))) || fs.existsSync(statePath(real)));
      if (deletable) fs.rmSync(real, { recursive: true, force: true });
      else problems.push(`left in place for inspection (not provably this run's fork, or the original theme is not active): ${themeDir}`);
    });
    // Theme-switch and setup options back to their snapshot; then exactly the fork's theme_mods_ row goes.
    const wpOptionsLeft = step('restore theme/setup options', () => restoreWpOptions(wp, wpOptionsBefore));
    if (wpOptionsLeft?.length) problems.push(`options not restored: ${wpOptionsLeft.join(', ')}`);
    const themeModsDropped = step('delete fork theme mods', () => (fs.existsSync(themeDir) ? false : dropThemeMods(wp, themeSlug)));
    const tailwindRestored = step('restore tailwind cache', () => restoreTailwind(wp, tailwindBefore));
    if (tailwindRestored === false) problems.push('Proto-Blocks Tailwind cache/option differ from the snapshot after restore');
    // Yoast options: always restore; keep the snapshot file if anything differs.
    const yoastAfter = step('restore yoast options', () => restoreOptions(wp, yoastBefore));
    const yoastRawAfter = step('read yoast options', () => ({ wpseo_titles: rawOption(wp, 'wpseo_titles'), wpseo_social: rawOption(wp, 'wpseo_social') }));
    const yoastIdentical = yoastAfter !== undefined && JSON.stringify(yoastAfter) === JSON.stringify(yoastBefore) && isDeepStrictEqual(yoastRawAfter, yoastRawBefore);
    if (yoastIdentical) { fs.rmSync(SNAPSHOT_FILE, { force: true }); run.update((d) => { d.yoast = null; }); }
    else problems.push(`Yoast options were not restored exactly; snapshot kept at ${SNAPSHOT_FILE}. Restore with:\n  ${RESTORE_COMMAND}`);
    // Leftover check.
    const after = step('fingerprint site', () => siteFingerprint(wp));
    const left = step('leftovers', () => leftovers(wp));
    const wpOptionsAfter = step('read options', () => snapshotWpOptions(wp, wpOptionNames));
    const themeModsAfter = step('theme mods list', () => themeModsList(wp));
    const leakedMods = step('leaked theme mods', () => leakedThemeMods(wp));
    const globalStylesDisabledAfter = step('global-styles setting', () => globalStylesDisabled(wp));
    // Everything restored: the run manifest goes; otherwise it stays for tests/recover.mjs.
    offSignals();
    if (problems.length) problems.push(`run manifest kept for recovery: ${run.file}`);
    else run.close();
    report.leftovers = {
      activeTheme: after?.stylesheet ?? null,
      activeThemeRestored: after?.stylesheet === before.stylesheet && after?.template === before.template,
      pbE2eBefore: leftoversBefore,
      pbE2eAfter: left ?? null,
      yoastOptionsIdentical: yoastIdentical,
      tailwindRestored: tailwindRestored === true,
      parts: after ? { same: isDeepStrictEqual(after.parts, before.parts), before: before.parts, after: after.parts } : null,
      templatePartsListSame: after ? after.templateParts === before.templateParts : null,
      menusSame: after ? after.menus === before.menus && after.navigations === before.navigations && isDeepStrictEqual(after.menu15, before.menu15) : null,
      menusBefore: { classic: before.menus, navigations: before.navigations, menu15: before.menu15 },
      menusAfter: after ? { classic: after.menus, navigations: after.navigations, menu15: after.menu15 } : null,
      pluginsSame: after ? after.plugins === before.plugins : null,
      devThemeSame: after ? isDeepStrictEqual(after.devTheme, before.devTheme) : null,
      themeModsDropped: themeModsDropped === true,
      themeModsBefore,
      themeModsAfter: themeModsAfter ?? null,
      leakedThemeMods: leakedMods ?? null,
      optionsSame: wpOptionsAfter ? isDeepStrictEqual(wpOptionsAfter, wpOptionsBefore) : null,
      globalStylesSetting: { disabledBefore: globalStylesDisabledBefore, disabledAfter: globalStylesDisabledAfter ?? null, same: globalStylesDisabledAfter === globalStylesDisabledBefore },
      runManifestLeft: fs.existsSync(run.file),
      optionsBefore: wpOptionsBefore,
      optionsAfter: wpOptionsAfter ?? null,
      problems,
    };
    report.finishedAt = new Date().toISOString();
    report.error = err ? String(err.stack ?? err) : null;
    try {
      fs.writeFileSync(path.join(work, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
      fs.writeFileSync(path.join(TMP, `e2e-last-summary-${globalStyles ? 'gs-on' : 'gs-off'}.json`), `${JSON.stringify(report, null, 2)}\n`);
    } catch { /* reporting only */ }
    say(`leftovers: ${JSON.stringify(report.leftovers)}`);
    say(`summary: ${path.join(work, 'summary.json')}`);
  }
  if (err) throw err;
  const L = report.leftovers;
  assert.deepEqual(L.problems, []);
  assert.equal(L.activeThemeRestored, true, 'original theme active again');
  assert.deepEqual(L.pbE2eAfter, { themes: [], menus: [], posts: [] }, 'no pb-e2e-* theme, menu, page or attachment left');
  assert.equal(L.yoastOptionsIdentical, true);
  assert.equal(L.tailwindRestored, true);
  assert.equal(L.parts.same, true, 'template parts 154/159 unchanged');
  assert.equal(L.templatePartsListSame, true);
  assert.equal(L.menusSame, true, 'menus unchanged');
  assert.equal(L.pluginsSame, true, 'plugins unchanged');
  assert.equal(L.devThemeSame, true, 'developer theme checkout untouched');
  assert.equal(L.themeModsDropped, true, `theme_mods_${themeSlug} was created by the switch and deleted`);
  assert.deepEqual(L.leakedThemeMods.filter((n) => n.startsWith('theme_mods_pb-e2e-')), [], 'no theme_mods_pb-e2e-* row left');
  assert.deepEqual(L.themeModsAfter, L.themeModsBefore, 'theme_mods_* rows identical to before the run');
  assert.equal(L.optionsSame, true, 'theme-switch, setup and plugin options identical to before the run');
  assert.equal(L.globalStylesSetting.same, true, 'Proto-Blocks "Disable WP Global Styles" as before the run');
  assert.equal(L.runManifestLeft, false, 'no run manifest left');
}

test('e2e (WP global styles disabled): design.html becomes a done landing page on the Local test site (scripts only)', { timeout: 900000 }, (t) => e2ePass(t, { globalStyles: false }));
test('e2e (WP global styles on): design.html becomes a done landing page on the Local test site (scripts only)', { timeout: 900000 }, (t) => e2ePass(t, { globalStyles: true }));
