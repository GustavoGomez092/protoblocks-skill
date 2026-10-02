// End-to-end scripted dry run: design.html -> intake -> plan -> gates -> page build -> per-section numeric QA ->
// motion -> page QA -> Yoast SEO -> done, driving the script surface only (no LLM judgement), on the Local test site.
//
// SAFETY (the developer's real site). Run it only through the site lock:
//   /private/tmp/claude-501/pb-site-test.sh <worktree> test:e2e
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
// - No navigation menus and no template parts are created: the pipeline stops before the header/footer part move.
//   Header and footer are verified as page sections only. The page renders through a slug-specific template in the
//   throwaway fork (templates/page-<slug>.html = the fork's page.html without the two template-part lines), standing
//   in for the part move, so the page shows the design's header and footer once. The part move is NOT covered here.
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
import { haveSite, PUBLIC, TEST_SITE, SITE_URL, ORIGINAL_THEME, testWp, restoreTheme } from '../integration/helpers.mjs';
import { haveQaDeps, QA_DIR } from '../qa/helpers.mjs';
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TMP = path.join(REPO, 'tests', '.tmp');
const BLOCKS = path.join(HERE, 'blocks');
const BLOCK_NAMES = ['site-header', 'hero-split', 'feature-grid', 'cta-band', 'site-footer'];
const THEMES = PUBLIC ? path.join(PUBLIC, 'wp-content', 'themes') : '';
const DEV_THEME = THEMES ? path.join(THEMES, 'proto-blocks-theme') : '';
const TW_DIR = PUBLIC ? path.join(PUBLIC, 'wp-content', 'uploads', 'proto-blocks', 'tailwind') : '';
const OPTIONS_PHP = path.join(REPO, 'tests', 'integration', 'yoast-options.php');
// Same crash-recovery file as tests/integration/yoast.test.mjs: one snapshot at a time, never overwritten.
const SNAPSHOT_FILE = path.join(TMP, 'yoast-options-snapshot.json');
const RESTORE_COMMAND = `${path.join(TMP, 'wp-test-site')} eval-file ${OPTIONS_PHP} restore ${SNAPSHOT_FILE}`;
const PARTS = [154, 159]; // the developer's header/footer template parts: read only
const MENU_ID = 15; // the developer's navigation menu: read only
const REQUIRED_PLUGINS = ['proto-blocks', 'wordpress-seo', 'safe-svg', 'duplicate-post'];
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
    attrs: { logo: 'Northwind Solar' }, inner: nav([['Features', '#features'], ['Pricing', '#pricing'], ['Contact', '#contact']]) },
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

const leftovers = (wp) => ({
  themes: fs.readdirSync(THEMES).filter((n) => n.startsWith('pb-e2e-')),
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

function snapshotTailwind(wp) {
  const files = {};
  if (fs.existsSync(TW_DIR)) {
    for (const e of fs.readdirSync(TW_DIR, { withFileTypes: true })) if (e.isFile()) files[e.name] = fs.readFileSync(path.join(TW_DIR, e.name));
  }
  const opt = wp.run(['option', 'get', 'proto_blocks_tailwind', '--format=json']);
  return { files, option: opt.code === 0 ? opt.stdout.trim() : null };
}
function restoreTailwind(wp, snap) {
  if (fs.existsSync(TW_DIR)) {
    for (const e of fs.readdirSync(TW_DIR, { withFileTypes: true })) {
      // Only plain files directly in the cache dir that did not exist before this run.
      if (e.isFile() && !Object.hasOwn(snap.files, e.name)) fs.rmSync(path.join(TW_DIR, e.name));
    }
  }
  for (const [name, buf] of Object.entries(snap.files)) fs.writeFileSync(path.join(TW_DIR, name), buf);
  if (snap.option !== null && rawOption(wp, 'proto_blocks_tailwind') !== snap.option) {
    wp.check(['option', 'update', 'proto_blocks_tailwind', snap.option, '--format=json']);
  }
  const now = snapshotTailwind(wp);
  const same = now.option === snap.option && Object.keys(now.files).length === Object.keys(snap.files).length
    && Object.entries(snap.files).every(([n, b]) => now.files[n] && Buffer.compare(now.files[n], b) === 0);
  return same;
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
  if (!haveQaDeps) return 'QA deps missing: run npm install in skills/protoblocks-site-builder/scripts/qa';
  if (!haveSite) return `start the Local site "${TEST_SITE}"`;
  if (!SITE_URL) return 'WP-CLI could not read siteurl (is the Local site running?)';
  if (!ORIGINAL_THEME || ORIGINAL_THEME.startsWith('pb-')) return 'the original theme is unknown (site left on a pb-* theme; set PB_TEST_THEME)';
  return '';
}

test('e2e: design.html becomes a done landing page on the Local test site (scripts only)', { timeout: 900000 }, async (t) => {
  const why = skipReason();
  if (why) { t.skip(why); return; }
  const wp = testWp();
  const plugins = JSON.parse(wp.check(['plugin', 'list', '--fields=name,status', '--format=json']));
  const inactive = REQUIRED_PLUGINS.filter((p) => !plugins.some((x) => x.name === p && x.status === 'active'));
  if (inactive.length) { t.skip(`setupSite would install/activate plugins (${inactive.join(', ')}); this test never writes to plugins`); return; }
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

  const yoastBefore = snapshotOptions(wp);
  const yoastRawBefore = { wpseo_titles: rawOption(wp, 'wpseo_titles'), wpseo_social: rawOption(wp, 'wpseo_social') };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(yoastBefore, null, 2));
  const tailwindBefore = snapshotTailwind(wp);

  let err;
  let pageId = null;
  const ownedMedia = [];
  let server;
  try {
    // 0. The design: block CSS is copied verbatim into design.html.
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
    const motionInstall = installMotion(themeDir);
    assert.ok(motionInstall.copied.includes('assets/js/pb-motion.js'));

    // 3. Blocks into the fork; the slug template that leaves the stock header/footer parts out (no part move).
    for (const b of BLOCK_NAMES) fs.cpSync(path.join(BLOCKS, b), path.join(themeDir, 'proto-blocks', b), { recursive: true });
    const pageTpl = fs.readFileSync(path.join(themeDir, 'templates', 'page.html'), 'utf8');
    const partLines = pageTpl.split('\n').filter((l) => /<!-- wp:template-part \{[^}]*"slug":"(header|footer)"/.test(l));
    assert.equal(partLines.length, 2, 'the fork page template has exactly the header and footer part lines');
    fs.writeFileSync(path.join(themeDir, 'templates', `page-${pageSlug}.html`), pageTpl.split('\n').filter((l) => !partLines.includes(l)).join('\n'));
    report.deviations.push(`page renders via templates/page-${pageSlug}.html in the throwaway fork (page.html minus the header/footer template parts), standing in for the part move`);

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
        if (def.inner) sec.inner = def.inner;
        sec.status = 'building';
      }
    });

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
    report.steps.build = { postId: built.postId, url: built.url, created: built.created, warnings: built.warnings };
    assert.equal(built.created, true);
    assert.deepEqual(built.warnings, []);
    const pageUrl = loadState(themeDir).pages.find((p) => p.slug === pageSlug).url;
    const html = (await fetchHtml(pageUrl)).body;
    for (const def of SECTIONS) assert.equal(html.split(`id="${def.anchor}"`).length - 1, 1, `#${def.anchor} renders once`);
    assert.ok(!html.includes('wp-block-template-part'), 'no template part on the e2e page');
    assert.match(html, /data-pb-motion="split-lines"[^>]*data-proto-animate="manual"/);
    assert.match(html, /data-pb-motion="fade-up"[^>]*data-proto-animate="manual"[^>]*data-pb-delay="0.15"/);
    lap('build');

    // 8. Per-section numeric QA: prepare -> check-section -> verdict built from result.json -> record.
    for (const def of SECTIONS) {
      budget(`verify section ${def.n}`);
      const { input } = prepareCheck(themeDir, pageSlug, def.n);
      const result = await checkSection(JSON.parse(fs.readFileSync(input, 'utf8')));
      const verdictFile = path.join(path.dirname(input), 'verdict.json');
      fs.writeFileSync(verdictFile, `${JSON.stringify(verdictFromResult(result), null, 2)}\n`);
      const rec = recordVerdict(themeDir, pageSlug, def.n, verdictFile);
      const row = {
        n: def.n, anchor: def.anchor, block: def.block, numericPass: result.numericPass, status: rec.status,
        breakpoints: result.results.map((r) => ({ name: r.breakpoint, mode: r.mode, numericPass: r.numericPass, mismatch: r.mismatch ?? null, heightDelta: r.heightDelta ?? null, widthDelta: r.widthDelta ?? null, sanityIssues: r.issues ?? undefined, error: r.error })),
        composite: result.results.find((r) => r.mode === 'diff')?.composite ?? null,
      };
      report.sections.push(row);
      say(`section ${def.n} ${def.anchor}: ${JSON.stringify(row.breakpoints.map((b) => [b.name, b.mismatch, b.heightDelta, b.widthDelta, b.numericPass]))}`);
      lap(`verify-${def.n}`);
    }
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
    assert.equal(nextAction(loadState(themeDir)).action, 'page-qa');

    // 10. Page QA against the full design frame (frames from state).
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

    // 11. SEO: OG image from the hero, apply (first apply on a fresh page; no organization leaf), audit, record.
    budget('seo');
    const ogFile = path.join(work, `pb-e2e-og-${hex}.png`);
    const og = await ogImage({ url: pageUrl, selector: '#pb-s2', out: ogFile });
    assert.equal(og.width, 1200);
    assert.equal(og.height, 630);
    const seo = SEO(ogFile);
    const applied = applySeo(wp, themeDir, pageSlug, seo, { index: false });
    for (const m of applied.media ?? []) ownedMedia.push(m);
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

    // 12. Done: the page is done and the next action asks for more pages.
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
    const tailwindRestored = step('restore tailwind cache', () => restoreTailwind(wp, tailwindBefore));
    if (tailwindRestored === false) problems.push('Proto-Blocks Tailwind cache/option differ from the snapshot after restore');
    // Yoast options: always restore; keep the snapshot file if anything differs.
    const yoastAfter = step('restore yoast options', () => restoreOptions(wp, yoastBefore));
    const yoastRawAfter = step('read yoast options', () => ({ wpseo_titles: rawOption(wp, 'wpseo_titles'), wpseo_social: rawOption(wp, 'wpseo_social') }));
    const yoastIdentical = yoastAfter !== undefined && JSON.stringify(yoastAfter) === JSON.stringify(yoastBefore) && isDeepStrictEqual(yoastRawAfter, yoastRawBefore);
    if (yoastIdentical) fs.rmSync(SNAPSHOT_FILE, { force: true });
    else problems.push(`Yoast options were not restored exactly; snapshot kept at ${SNAPSHOT_FILE}. Restore with:\n  ${RESTORE_COMMAND}`);
    // Leftover check.
    const after = step('fingerprint site', () => siteFingerprint(wp));
    const left = step('leftovers', () => leftovers(wp));
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
      pluginsSame: after ? after.plugins === before.plugins : null,
      devThemeSame: after ? isDeepStrictEqual(after.devTheme, before.devTheme) : null,
      problems,
    };
    report.finishedAt = new Date().toISOString();
    report.error = err ? String(err.stack ?? err) : null;
    try {
      fs.writeFileSync(path.join(work, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
      fs.writeFileSync(path.join(TMP, 'e2e-last-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
    } catch { /* reporting only */ }
    say(`leftovers: ${JSON.stringify(report.leftovers)}`);
    say(`summary: ${path.join(work, 'summary.json')}`);
  }
  if (err) throw err;
  const L = report.leftovers;
  assert.deepEqual(L.problems, []);
  assert.equal(L.activeThemeRestored, true, 'original theme active again');
  assert.deepEqual(L.pbE2eAfter, { themes: [], posts: [] }, 'no pb-e2e-* theme, page or attachment left');
  assert.equal(L.yoastOptionsIdentical, true);
  assert.equal(L.tailwindRestored, true);
  assert.equal(L.parts.same, true, 'template parts 154/159 unchanged');
  assert.equal(L.templatePartsListSame, true);
  assert.equal(L.menusSame, true, 'menus unchanged');
  assert.equal(L.pluginsSame, true, 'plugins unchanged');
  assert.equal(L.devThemeSame, true, 'developer theme checkout untouched');
});
