import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { itest, testWp, restoreTheme, ORIGINAL_THEME, PUBLIC, TEST_SITE, takeThemeSnapshot, dropThemeMods, leakedThemeMods, setupWriteReason, snapshotOptions, SETUP_OPTION_NAMES } from './helpers.mjs';
import { setupSite } from '../../skills/protoblocks-site-builder/scripts/lib/setup-site.mjs';
import { MANAGED_START } from '../../skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs';
import { loadState, statePath } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { forkMarker } from '../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs';

// SAFETY: runs against the developer's real Local site. It creates exactly ONE theme folder with a unique
// slug (pb-itest-setup-<hex>), restores the original active theme in `finally`, and only then deletes that
// exact folder if it sits directly inside the themes dir under the unique slug and carries the fork marker;
// otherwise it logs the path and leaves it. A failure mid-way is rethrown unchanged (cleanup never masks it).
// It never touches the developer's own theme checkout, and setupSite never reinstalls installed plugins.
const THEMES = path.join(PUBLIC, 'wp-content', 'themes');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const gitStatus = (dir) => spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout;

itest('setupSite forks, activates and records state; a second run reuses the fork', async (t) => {
  const wp = testWp();
  // setupSite writes plugins/options unless they are already in their target state: skip rather than write.
  const why = setupWriteReason(wp);
  if (why) { t.skip(why); return; }
  const optionsBefore = snapshotOptions(wp, SETUP_OPTION_NAMES);
  const slug = `pb-itest-setup-${crypto.randomBytes(4).toString('hex')}`;
  const themeDir = path.join(THEMES, slug);
  const origDir = path.join(THEMES, ORIGINAL_THEME);
  const before = wp.check(['option', 'get', 'stylesheet']).trim();
  const pluginsBefore = wp.check(['plugin', 'list', '--fields=name,status,version', '--format=json']);
  const origGitBefore = fs.existsSync(path.join(origDir, '.git')) ? gitStatus(origDir) : null;
  t.diagnostic(`stylesheet before: ${before}`);
  // Crash recovery file used by helpers.mjs (read when a previous run died on a pb-* theme).
  fs.mkdirSync(path.join(REPO, 'tests', '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'tests', '.tmp', 'original-theme.txt'), before);
  let err;
  const problems = [];
  takeThemeSnapshot(wp);
  try {
    const opts = { cwd: PUBLIC, site: TEST_SITE, name: 'PB Itest Setup', slug };
    const first = await setupSite(opts);
    t.diagnostic(`plugins: ${JSON.stringify(first.plugins)}`);
    assert.equal(first.theme.slug, slug);
    assert.equal(first.theme.reused, false);
    assert.equal(fs.realpathSync(first.theme.themeDir), fs.realpathSync(themeDir));
    assert.equal(first.stateFile, statePath(themeDir));
    assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), slug);
    for (const p of first.plugins.plugins) assert.ok(['ok', 'installed', 'activated'].includes(p.action), `${p.slug} ${p.action}`);
    assert.equal(first.plugins.plugins.length, 4);
    assert.ok(first.assets.copied.length > 0);
    const s1 = loadState(themeDir);
    assert.equal(s1.site.theme.slug, slug);
    assert.equal(s1.site.url, first.preflight.url);

    const second = await setupSite({ ...opts, force: true });
    assert.equal(second.theme.reused, true, 'force never replaces an existing fork');
    assert.equal(second.stateFile, first.stateFile);
    const fn = fs.readFileSync(path.join(themeDir, 'functions.php'), 'utf8');
    assert.equal(fn.split(MANAGED_START).length - 1, 1, 'managed block must appear exactly once');
    assert.equal(loadState(themeDir).site.theme.slug, slug);
    assert.ok(second.plugins.plugins.every((p) => p.action === 'ok'), 'second run leaves plugins alone');
  } catch (e) {
    err = e;
  } finally {
    try { restoreTheme(wp); } catch (e) { problems.push(`restoreTheme failed: ${e.message}`); }
    const after = wp.run(['option', 'get', 'stylesheet']).stdout.trim();
    t.diagnostic(`stylesheet after: ${after}`);
    if (fs.existsSync(themeDir)) {
      const real = fs.realpathSync(themeDir);
      const style = path.join(real, 'style.css');
      const deletable = after === before
        && !fs.lstatSync(themeDir).isSymbolicLink()
        && path.dirname(real) === fs.realpathSync(THEMES)
        && path.basename(real) === slug && /^pb-itest-setup-[0-9a-f]{8}$/.test(slug)
        && fs.existsSync(style) && forkMarker(fs.readFileSync(style, 'utf8'));
      if (deletable) fs.rmSync(real, { recursive: true, force: true });
      else problems.push(`left in place for inspection (not provably this test's fork, or the original theme is not active): ${themeDir}`);
    }
    // The switch created theme_mods_<slug>; delete exactly that row once the fork is gone.
    if (!fs.existsSync(themeDir)) { try { dropThemeMods(wp, slug); } catch (e) { problems.push(`theme mods: ${e.message}`); } }
    t.diagnostic(`themes: ${fs.readdirSync(THEMES).join(', ')}`);
    t.diagnostic(`plugins before: ${pluginsBefore.trim()}`);
    t.diagnostic(`plugins after: ${wp.run(['plugin', 'list', '--fields=name,status,version', '--format=json']).stdout.trim()}`);
    for (const p of problems) t.diagnostic(p);
  }
  if (err) throw err;
  assert.deepEqual(problems, []);
  assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), before);
  assert.equal(fs.existsSync(themeDir), false);
  assert.deepEqual(fs.readdirSync(THEMES).filter((n) => n.startsWith('pb-itest-setup-')), []);
  assert.deepEqual(leakedThemeMods(wp).filter((n) => n === `theme_mods_${slug}`), [], 'no theme_mods_ row left for the fork');
  assert.deepEqual(snapshotOptions(wp, SETUP_OPTION_NAMES), optionsBefore, 'setupSite wrote no option');
  assert.equal(wp.check(['plugin', 'list', '--fields=name,status,version', '--format=json']), pluginsBefore, 'plugins unchanged');
  if (origGitBefore !== null) assert.equal(gitStatus(origDir), origGitBefore, 'developer theme checkout must be unmodified');
});
