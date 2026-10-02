import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWp, WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { resolveLocalSite, writeWrapper } from '../../skills/protoblocks-site-builder/scripts/lib/local-site.mjs';
import {
  createRun, leftoverReason, THROWAWAY_FORK, onInterrupt, recoverOnSignal, LOCK_SCRIPT, RECOVER_COMMAND,
  snapshotTailwind as snapTailwind, restoreTailwind as putTailwind, restoreOptions as putOptions, rawOption,
} from '../site-run.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEST_SITE = process.env.PB_TEST_SITE ?? 'Proto Blocks';

// Site tests run on the developer's real Local site, one run at a time across worktrees. They only run under the
// lock script (tests/README.md), which exports PB_SITE_LOCK=1; anything else skips before WP-CLI is ever called.
export const SITE_LOCKED = process.env.PB_SITE_LOCK === '1';
export const LOCK_REASON = `run via the site lock script: ${LOCK_SCRIPT} <worktree> <npm script> (tests/README.md)`;

const resolved = resolveLocalSite({ query: TEST_SITE });
const WRAPPER = path.join(REPO, 'tests', '.tmp', 'wp-test-site');
if (resolved.ok && SITE_LOCKED) writeWrapper(WRAPPER, resolved.site);

export const haveSite = resolved.ok;
export const PUBLIC = resolved.ok ? resolved.site.publicPath : '';
const boot = resolved.ok && SITE_LOCKED ? createWp({ wp: WRAPPER, mode: 'local-wrapper', publicPath: PUBLIC }) : null;

let siteUrl = '';
let originalTheme = '';
let skipReason = SITE_LOCKED ? '' : LOCK_REASON;

if (boot) {
  try {
    siteUrl = boot.check(['option', 'get', 'siteurl']).trim();
  } catch (err) {
    skipReason = `WP-CLI failed to get siteurl: ${err.message}`;
  }
  try {
    const active = boot.check(['option', 'get', 'stylesheet']).trim();
    if (active.startsWith('pb-')) {
      // Crashed run left site on pb-itest or pb-* theme. Recover the original.
      originalTheme = process.env.PB_TEST_THEME ||
        (fs.existsSync(path.join(REPO, 'tests', '.tmp', 'original-theme.txt'))
          ? fs.readFileSync(path.join(REPO, 'tests', '.tmp', 'original-theme.txt'), 'utf8').trim()
          : '');
      if (!originalTheme) {
        skipReason = `test site left on ${active}; set PB_TEST_THEME`;
      }
    } else {
      originalTheme = active;
    }
  } catch (err) {
    skipReason = `WP-CLI failed to get stylesheet: ${err.message}`;
  }
}

// An interrupted earlier run (its manifest is still in tests/.tmp) may have left the site changed: refuse to start.
const leftover = boot ? leftoverReason() : '';

export const SITE_URL = siteUrl;
export const ORIGINAL_THEME = originalTheme;
export const runtime = { wp: WRAPPER, mode: 'local-wrapper', publicPath: PUBLIC, url: SITE_URL };
/** Why site tests must not run now ('' when they may): the lock, the site, WP-CLI or an unknown original theme. */
export const siteSkipReason = () => (!SITE_LOCKED ? LOCK_REASON : !haveSite ? `start the Local site "${TEST_SITE}"` : skipReason);
/** Why site tests must refuse to start ('' when they may): a manifest left by an interrupted run. */
export const siteRefuseReason = () => leftover;
export const itest = (name, fn) => {
  if (!SITE_LOCKED) return test.skip(`${name} (${LOCK_REASON})`, fn);
  if (!haveSite) return test.skip(`${name} (start the Local site "${TEST_SITE}")`, fn);
  if (skipReason) return test.skip(`${name} (${skipReason})`, fn);
  if (leftover) return test(name, () => { throw new Error(leftover); });
  return test(name, fn);
};
export const testWp = () => {
  if (!SITE_LOCKED) throw Object.assign(new Error(`Refusing to talk to the test site: ${LOCK_REASON}`), { code: 'ENOLOCK' });
  return createWp(runtime);
};

// The run manifest of this test file's process (tests/site-run.mjs): written before the first site change, updated
// with every snapshot and every post/term/theme folder the tests create, removed again as they clean up. SIGTERM/SIGINT
// run the same restore synchronously; a manifest that is not empty when the process exits stays for tests/recover.mjs.
let run = null;
export function siteRun() {
  if (run) return run;
  if (!SITE_LOCKED || !boot) throw Object.assign(new Error(`Refusing to record site changes: ${siteSkipReason() || 'no site'}`), { code: 'ENOLOCK' });
  run = createRun({ kind: 'integration', test: path.basename(process.argv[1] ?? ''), site: TEST_SITE, publicPath: PUBLIC, wrapper: WRAPPER });
  onInterrupt((sig) => recoverOnSignal(createWp(runtime), run, sig));
  process.on('exit', () => {
    if (run.isEmpty()) run.close();
    else process.stderr.write(`site-test run manifest kept (cleanup incomplete): ${run.file}\nRestore the site with: ${RECOVER_COMMAND}\n`);
  });
  return run;
}
/** Records a post this test created (or is about to create, by its unique name); type and name are checked on recovery. */
export const trackPost = (rec) => siteRun().addPost(rec);
/** Forgets the posts matching `pred` (deleted by the test itself). */
export const untrackPosts = (pred) => siteRun().dropPosts(pred);
export const trackTerm = (rec) => siteRun().addTerm(rec);
export const untrackTerms = (pred) => siteRun().dropTerms(pred);
/** Records a throwaway theme folder (`foreign: true` for a plain folder that is not a fork). */
export const trackFork = (rec) => siteRun().addFork(rec);
export const untrackFork = (slug) => siteRun().dropFork(slug);
/** Deletes the given post ids (`--force`) and forgets the ones that are gone. */
export function deleteOwnPosts(wp, ids) {
  for (const id of ids) wp.run(['post', 'delete', String(id), '--force']);
  const gone = new Set(ids.map(Number).filter((id) => wp.run(['post', 'get', String(id), '--field=ID']).code !== 0));
  if (run) untrackPosts((p) => gone.has(p.id));
  return [...gone];
}

export async function useItestTheme(wp) {
  const themes = path.join(PUBLIC, 'wp-content', 'themes');
  const dir = path.join(themes, 'pb-itest');
  const tmpDir = path.join(REPO, 'tests', '.tmp');
  const originalThemeFile = path.join(tmpDir, 'original-theme.txt');

  if (!fs.existsSync(path.join(dir, 'style.css'))) {
    // forkTheme removes only what it created itself when it fails, so nothing here deletes "pb-itest":
    // a pre-existing folder this helper did not create is left for a human to inspect.
    const { fetchThemeZip, forkTheme } = await import('../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs');
    const { zipFile, forkedFrom, cleanup } = await fetchThemeZip();
    try {
      forkTheme({ wp, themesDir: themes, name: 'PB Itest', slug: 'pb-itest', zipFile, forkedFrom });
    } finally {
      cleanup();
    }
  }

  // Record original theme before switching
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(originalThemeFile, ORIGINAL_THEME);

  // The shared fixture keeps its theme_mods_pb-itest row, but its value is put back too.
  takeThemeSnapshot(wp, ['theme_mods_pb-itest']);
  wp.check(['theme', 'activate', 'pb-itest']);
  return dir;
}

// The theme-switch options as they were before the first switch of the current test (see takeThemeSnapshot).
let themeSnap = null;
/** Call before a test switches themes; restoreTheme puts these options back after re-activating the original. */
export function takeThemeSnapshot(wp, extraOptions = []) {
  if (!themeSnap) {
    themeSnap = { options: snapshotOptions(wp, [...themeOptionNames(), ...extraOptions]), tailwind: snapshotTailwind(wp) };
    // Into the run manifest before the switch, so an interrupted run can put them back.
    siteRun().update((d) => { d.originalTheme = ORIGINAL_THEME; d.options = { ...d.options, ...themeSnap.options }; }).setTailwind(themeSnap.tailwind);
  }
  return themeSnap;
}

/**
 * Re-activates the original theme, then restores the theme-switch options and the Tailwind cache, also when the
 * activation fails (the failure is still thrown afterwards, with anything not restored). Until everything is back the
 * snapshot is kept, so calling it again retries the whole restore.
 */
export const restoreTheme = (wp) => {
  const tmpDir = path.join(REPO, 'tests', '.tmp');
  const originalThemeFile = path.join(tmpDir, 'original-theme.txt');
  const errors = [];
  try {
    wp.check(['theme', 'activate', ORIGINAL_THEME]);
    if (fs.existsSync(originalThemeFile)) fs.unlinkSync(originalThemeFile);
  } catch (e) {
    errors.push(`re-activating ${ORIGINAL_THEME} failed: ${e.message}`);
  }
  if (themeSnap) {
    const snap = themeSnap;
    let left = [];
    try { left = restoreOptions(wp, snap.options); } catch (e) { left = [`options (${e.message})`]; }
    let tw = false;
    try { tw = restoreTailwind(wp, snap.tailwind); } catch { /* reported below */ }
    if (!tw) left.push('Proto-Blocks Tailwind cache');
    if (left.length) errors.push(`theme-switch options not restored: ${left.join(', ')}`);
    else if (!errors.length) {
      themeSnap = null;
      run?.update((d) => { d.originalTheme = null; for (const n of Object.keys(snap.options)) delete d.options[n]; }).clearTailwind();
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
};

// Options a theme switch writes (wp-includes/theme.php switch_theme): the theme mods of the theme switched to and
// from, the widget assignment, theme_switched and current_theme. Throwaway themes get their row deleted; the rest
// are snapshotted before a switch and put back after.
export const themeOptionNames = () => [`theme_mods_${ORIGINAL_THEME}`, 'sidebars_widgets', 'theme_switched', 'current_theme'];
export const snapshotOptions = (wp, names) => Object.fromEntries(names.map((n) => [n, rawOption(wp, n)]));
/** Puts each option back to its snapshot (deleting the ones that were absent); returns the names still different. */
export const restoreOptions = (wp, snap) => putOptions(wp, snap);

// Throwaway theme slugs whose theme_mods_ row a test may delete: exactly the per-run unique forks.
const THROWAWAY_THEME = THROWAWAY_FORK;
/** Deletes exactly theme_mods_<slug> of a throwaway fork that is no longer active (no pattern, no other row). */
export function dropThemeMods(wp, slug) {
  if (!THROWAWAY_THEME.test(slug)) throw new Error(`refusing to delete theme_mods_${slug}: not a throwaway test theme`);
  if (wp.check(['option', 'get', 'stylesheet']).trim() === slug) throw new Error(`refusing to delete theme_mods_${slug}: the theme is still active`);
  if (rawOption(wp, `theme_mods_${slug}`) === null) return false;
  wp.check(['option', 'delete', `theme_mods_${slug}`]);
  return true;
}
/** theme_mods_ rows of throwaway test themes still in the options table (should be none). */
export const leakedThemeMods = (wp) => JSON.parse(wp.check(['option', 'list', '--search=theme_mods_pb-*', '--fields=option_name', '--format=json']))
  .map((o) => o.option_name).filter((n) => THROWAWAY_THEME.test(n.replace(/^theme_mods_/, '')));

/**
 * setupSite/ensurePlugins write site options unless they are already in their target state (setup-plugins.mjs): the
 * Proto-Blocks wizard flag, Tailwind enabled with component style "tailwind", and non-plain permalinks. Site tests
 * only call them when every one already holds, so nothing is written. Returns the reason to skip, or ''.
 */
export function setupWriteReason(wp) {
  const out = [];
  if (wp.run(['option', 'get', 'proto_blocks_wizard_completed']).stdout.trim() !== '1') out.push('proto_blocks_wizard_completed is not 1');
  if (wp.run(['option', 'get', 'proto_blocks_component_style']).stdout.trim() !== 'tailwind') out.push('proto_blocks_component_style is not "tailwind"');
  let tw = null;
  try { tw = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['status']); } catch { /* reported below */ }
  if (tw?.enabled !== true) out.push('Proto-Blocks Tailwind is not enabled');
  if (wp.run(['option', 'get', 'permalink_structure']).stdout.trim() === '') out.push('permalinks are plain');
  const plugins = JSON.parse(wp.check(['plugin', 'list', '--fields=name,status', '--format=json']));
  const inactive = ['proto-blocks', 'wordpress-seo', 'safe-svg', 'duplicate-post'].filter((p) => !plugins.some((x) => x.name === p && x.status === 'active'));
  if (inactive.length) out.push(`plugins not active: ${inactive.join(', ')}`);
  return out.length ? `setup would write to the site (${out.join('; ')}); set it up by hand first` : '';
}
export const SETUP_OPTION_NAMES = ['proto_blocks_wizard_completed', 'proto_blocks_component_style', 'permalink_structure'];

// Gates and tokens recompile Proto-Blocks' site-wide Tailwind cache for the active (test) theme; tests put it back.
// The cache files, directories and the proto_blocks_tailwind option (tests/site-run.mjs).
export const snapshotTailwind = (wp) => snapTailwind(wp, PUBLIC);
/** Puts the cache and option back byte for byte; true when they match the snapshot afterwards. */
export const restoreTailwind = (wp, snap) => putTailwind(wp, PUBLIC, snap);
