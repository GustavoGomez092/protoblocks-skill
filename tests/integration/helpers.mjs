import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createWp, WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { resolveLocalSite, writeWrapper } from '../../skills/protoblocks-site-builder/scripts/lib/local-site.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEST_SITE = process.env.PB_TEST_SITE ?? 'Proto Blocks';

// Site tests run on the developer's real Local site, one run at a time across worktrees. They only run under the
// lock script (tests/README.md), which exports PB_SITE_LOCK=1; anything else skips before WP-CLI is ever called.
export const SITE_LOCKED = process.env.PB_SITE_LOCK === '1';
export const LOCK_REASON = 'run via the site lock script: /private/tmp/claude-501/pb-site-test.sh <worktree> <npm script> (tests/README.md)';

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

export const SITE_URL = siteUrl;
export const ORIGINAL_THEME = originalTheme;
export const runtime = { wp: WRAPPER, mode: 'local-wrapper', publicPath: PUBLIC, url: SITE_URL };
/** Why site tests must not run now ('' when they may): the lock, the site, WP-CLI or an unknown original theme. */
export const siteSkipReason = () => (!SITE_LOCKED ? LOCK_REASON : !haveSite ? `start the Local site "${TEST_SITE}"` : skipReason);
export const itest = (name, fn) => {
  if (!SITE_LOCKED) return test.skip(`${name} (${LOCK_REASON})`, fn);
  if (!haveSite) return test.skip(`${name} (start the Local site "${TEST_SITE}")`, fn);
  if (skipReason) return test.skip(`${name} (${skipReason})`, fn);
  return test(name, fn);
};
export const testWp = () => {
  if (!SITE_LOCKED) throw Object.assign(new Error(`Refusing to talk to the test site: ${LOCK_REASON}`), { code: 'ENOLOCK' });
  return createWp(runtime);
};

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
  themeSnap ??= { options: snapshotOptions(wp, [...themeOptionNames(), ...extraOptions]), tailwind: snapshotTailwind(wp) };
  return themeSnap;
}

export const restoreTheme = (wp) => {
  const tmpDir = path.join(REPO, 'tests', '.tmp');
  const originalThemeFile = path.join(tmpDir, 'original-theme.txt');
  wp.check(['theme', 'activate', ORIGINAL_THEME]);
  if (fs.existsSync(originalThemeFile)) {
    fs.unlinkSync(originalThemeFile);
  }
  if (themeSnap) {
    const snap = themeSnap;
    themeSnap = null;
    const left = restoreOptions(wp, snap.options);
    if (!restoreTailwind(wp, snap.tailwind)) left.push('Proto-Blocks Tailwind cache');
    if (left.length) throw new Error(`theme-switch options not restored: ${left.join(', ')}`);
  }
};

// Options a theme switch writes (wp-includes/theme.php switch_theme): the theme mods of the theme switched to and
// from, the widget assignment, theme_switched and current_theme. Throwaway themes get their row deleted; the rest
// are snapshotted before a switch and put back after.
const rawOption = (wp, name) => {
  const r = wp.run(['option', 'get', name, '--format=json']);
  return r.code === 0 ? r.stdout.trim() : null;
};
export const themeOptionNames = () => [`theme_mods_${ORIGINAL_THEME}`, 'sidebars_widgets', 'theme_switched', 'current_theme'];
export const snapshotOptions = (wp, names) => Object.fromEntries(names.map((n) => [n, rawOption(wp, n)]));
/** Puts each option back to its snapshot (deleting the ones that were absent); returns the names still different. */
export function restoreOptions(wp, snap) {
  for (const [name, value] of Object.entries(snap)) {
    const now = rawOption(wp, name);
    if (now === value) continue;
    if (value === null) wp.check(['option', 'delete', name]);
    else wp.check(['option', 'update', name, value, '--format=json']);
  }
  return Object.entries(snapshotOptions(wp, Object.keys(snap))).filter(([n, v]) => v !== snap[n]).map(([n]) => n);
}

// Throwaway theme slugs whose theme_mods_ row a test may delete: exactly the per-run unique forks.
const THROWAWAY_THEME = /^pb-(e2e|itest-fork|itest-setup)-[0-9a-f]{8}$/;
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
// Proto-Blocks' Tailwind cache: every file under uploads/proto-blocks/tailwind (recursively), whether the cache dir and
// its parent existed, and the proto_blocks_tailwind option (null = absent).
const TW_DIR = PUBLIC ? path.join(PUBLIC, 'wp-content', 'uploads', 'proto-blocks', 'tailwind') : '';
const TW_PARENT = TW_DIR ? path.dirname(TW_DIR) : '';
function walkFiles(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else if (e.isFile()) out[path.relative(base, p)] = fs.readFileSync(p);
  }
  return out;
}
function walkDirs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) { const p = path.join(dir, e.name); out.push(p); walkDirs(p, out); }
  return out;
}
export function snapshotTailwind(wp) {
  const exists = fs.existsSync(TW_DIR);
  const opt = wp.run(['option', 'get', 'proto_blocks_tailwind', '--format=json']);
  return {
    parentExisted: fs.existsSync(TW_PARENT),
    dirExisted: exists,
    dirs: exists ? walkDirs(TW_DIR).map((d) => path.relative(TW_DIR, d)) : [],
    files: exists ? walkFiles(TW_DIR) : {},
    option: opt.code === 0 ? opt.stdout.trim() : null,
  };
}
export function restoreTailwind(wp, snap) {
  if (fs.existsSync(TW_DIR)) {
    // Files this run added (not in the snapshot), then directories it added, deepest first, only when empty.
    for (const rel of Object.keys(walkFiles(TW_DIR))) if (!Object.hasOwn(snap.files, rel)) fs.rmSync(path.join(TW_DIR, rel));
    for (const d of walkDirs(TW_DIR).sort((a, b) => b.length - a.length)) {
      if (!snap.dirs.includes(path.relative(TW_DIR, d)) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    }
  }
  for (const [rel, buf] of Object.entries(snap.files)) {
    fs.mkdirSync(path.dirname(path.join(TW_DIR, rel)), { recursive: true });
    fs.writeFileSync(path.join(TW_DIR, rel), buf);
  }
  // A cache dir (and parent) the run created goes again when empty.
  if (!snap.dirExisted && fs.existsSync(TW_DIR) && fs.readdirSync(TW_DIR).length === 0) fs.rmdirSync(TW_DIR);
  if (!snap.parentExisted && fs.existsSync(TW_PARENT) && fs.readdirSync(TW_PARENT).length === 0) fs.rmdirSync(TW_PARENT);
  const opt = wp.run(['option', 'get', 'proto_blocks_tailwind', '--format=json']);
  const now = opt.code === 0 ? opt.stdout.trim() : null;
  if (snap.option === null && now !== null) wp.check(['option', 'delete', 'proto_blocks_tailwind']);
  else if (snap.option !== null && now !== snap.option) wp.check(['option', 'update', 'proto_blocks_tailwind', snap.option, '--format=json']);
  const after = snapshotTailwind(wp);
  return after.option === snap.option && after.dirExisted === snap.dirExisted && after.parentExisted === snap.parentExisted
    && isDeepStrictEqual(after.dirs.sort(), [...snap.dirs].sort())
    && Object.keys(after.files).length === Object.keys(snap.files).length
    && Object.entries(snap.files).every(([n, b]) => after.files[n] && Buffer.compare(after.files[n], b) === 0);
}

