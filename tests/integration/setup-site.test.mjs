import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { itest, testWp, restoreTheme, ORIGINAL_THEME, PUBLIC, TEST_SITE } from './helpers.mjs';
import { setupSite } from '../../skills/protoblocks-site-builder/scripts/lib/setup-site.mjs';
import { MANAGED_START } from '../../skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs';
import { loadState, statePath } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

// SAFETY: runs against the developer's real Local site. It creates exactly ONE theme folder with a unique
// slug (pb-itest-setup-<hex>), restores the original active theme in `finally`, and only then deletes that
// exact folder after asserting it is directly inside the themes dir, has the unique slug as its name, and
// holds .protoblocks/build.json. It never touches the developer's own theme checkout.
const THEMES = path.join(PUBLIC, 'wp-content', 'themes');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const gitStatus = (dir) => spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout;

itest('setupSite forks, activates and records state; a second run reuses the fork', async (t) => {
  const wp = testWp();
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
  let restored = false;
  try {
    const opts = { cwd: PUBLIC, site: TEST_SITE, name: 'PB Itest Setup', slug };
    const first = await setupSite(opts);
    t.diagnostic(`plugins: ${JSON.stringify(first.plugins)}`);
    assert.equal(first.theme.slug, slug);
    assert.equal(first.theme.reused, false);
    assert.equal(fs.realpathSync(first.theme.themeDir), fs.realpathSync(themeDir));
    assert.equal(first.stateFile, statePath(themeDir));
    assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), slug);
    for (const p of first.plugins.plugins) assert.ok(['ok', 'installed', 'activated', 'updated'].includes(p.action), p.slug);
    assert.equal(first.plugins.plugins.length, 4);
    assert.ok(first.assets.copied.length > 0);
    const s1 = loadState(themeDir);
    assert.equal(s1.site.theme.slug, slug);
    assert.equal(s1.site.url, first.preflight.url);

    const second = await setupSite(opts);
    assert.equal(second.theme.reused, true);
    assert.equal(second.stateFile, first.stateFile);
    const fn = fs.readFileSync(path.join(themeDir, 'functions.php'), 'utf8');
    assert.equal(fn.split(MANAGED_START).length - 1, 1, 'managed block must appear exactly once');
    assert.equal(loadState(themeDir).site.theme.slug, slug);
    assert.ok(second.plugins.plugins.every((p) => p.action === 'ok'), 'second run leaves plugins alone');
  } finally {
    restoreTheme(wp);
    restored = true;
    const after = wp.check(['option', 'get', 'stylesheet']).trim();
    t.diagnostic(`stylesheet after: ${after}`);
    if (fs.existsSync(themeDir)) {
      assert.equal(after, before, 'original theme must be active before deleting the test theme');
      const real = fs.realpathSync(themeDir);
      assert.equal(path.dirname(real), fs.realpathSync(THEMES), 'theme must sit directly inside the themes dir');
      assert.equal(path.basename(real), slug);
      assert.match(slug, /^pb-itest-setup-[0-9a-f]{8}$/);
      assert.ok(fs.existsSync(path.join(real, '.protoblocks', 'build.json')), 'refusing to delete a folder without build state');
      fs.rmSync(real, { recursive: true, force: true });
    }
    t.diagnostic(`themes: ${fs.readdirSync(THEMES).join(', ')}`);
    t.diagnostic(`plugins before: ${pluginsBefore.trim()}`);
    t.diagnostic(`plugins after: ${wp.check(['plugin', 'list', '--fields=name,status,version', '--format=json']).trim()}`);
  }
  assert.ok(restored);
  assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), before);
  assert.equal(fs.existsSync(themeDir), false);
  assert.deepEqual(fs.readdirSync(THEMES).filter((n) => n.startsWith('pb-itest-setup-')), []);
  if (origGitBefore !== null) assert.equal(gitStatus(origDir), origGitBefore, 'developer theme checkout must be unmodified');
});
