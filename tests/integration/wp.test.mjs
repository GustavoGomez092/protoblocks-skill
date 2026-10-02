import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from '../../skills/protoblocks-site-builder/scripts/lib/exec.mjs';
import {
  itest, testWp, SITE_URL, PUBLIC, useItestTheme, restoreTheme, ORIGINAL_THEME, siteRun, snapshotOptions, themeOptionNames,
  snapshotTailwind, leakedThemeMods,
} from './helpers.mjs';

// What a theme switch may leave behind: the switch options, the shared fixture's mods row, the Tailwind cache.
const switchOptions = (wp) => snapshotOptions(wp, [...themeOptionNames(), 'theme_mods_pb-itest', 'stylesheet', 'template']);

itest('runner talks to the Local test site', () => {
  assert.match(SITE_URL, /^https?:\/\//);
  assert.equal(testWp().check(['option', 'get', 'siteurl']).trim(), SITE_URL);
});

itest('useItestTheme activates a throwaway copy and restoreTheme puts the original back', async () => {
  const wp = testWp();
  const optionsBefore = switchOptions(wp);
  const tailwindBefore = snapshotTailwind(wp);
  const leakedBefore = leakedThemeMods(wp);
  try {
    const dir = await useItestTheme(wp);
    assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), 'pb-itest');
    assert.ok(fs.existsSync(path.join(dir, 'style.css')), 'pb-itest/style.css exists');

    // If .git exists, verify it contains only the fork marker commit, not developer history
    const gitDir = path.join(dir, '.git');
    if (fs.existsSync(gitDir)) {
      const result = exec('git', ['log', '--format=%s'], { cwd: dir });
      assert.equal(result.code, 0, 'git log must succeed');
      const lines = result.stdout.trim().split('\n').filter(l => l.length > 0);
      assert.equal(lines.length, 1, 'must have exactly 1 commit (the fork marker)');
      assert.ok(lines[0].startsWith('chore: fork'), `first commit must start with 'chore: fork', got: ${lines[0]}`);
    }
  } finally {
    restoreTheme(wp);
  }
  assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), ORIGINAL_THEME);
  assert.ok(fs.existsSync(path.join(PUBLIC, 'wp-content/themes', ORIGINAL_THEME)));
  // Leftovers: nothing of the switch stays.
  assert.deepEqual(switchOptions(wp), optionsBefore, 'theme-switch options as before');
  assert.deepEqual(snapshotTailwind(wp), tailwindBefore, 'Tailwind cache and option as before');
  assert.deepEqual(leakedThemeMods(wp), leakedBefore, 'no theme_mods_ row of a throwaway theme added');
  assert.equal(siteRun().isEmpty(), true, 'the run manifest has nothing left to restore');
});

itest('restoreTheme restores the switch options even when re-activating the original theme fails, and retries', async () => {
  const wp = testWp();
  const optionsBefore = switchOptions(wp);
  // The same WP-CLI, except that `theme activate` fails.
  const broken = { ...wp, check: (args, o) => { if (args[0] === 'theme' && args[1] === 'activate') throw new Error('simulated activation failure'); return wp.check(args, o); } };
  await useItestTheme(wp);
  try {
    assert.throws(() => restoreTheme(broken), /re-activating .* failed: simulated activation failure/);
    const now = switchOptions(wp);
    assert.equal(now.sidebars_widgets, optionsBefore.sidebars_widgets, 'options restored despite the failed activation');
    assert.equal(now['theme_mods_pb-itest'], optionsBefore['theme_mods_pb-itest']);
    assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), 'pb-itest', 'still on the fixture theme');
    assert.equal(siteRun().isEmpty(), false, 'the manifest still lists the switch');
  } finally {
    restoreTheme(wp); // the retry: activation, options and Tailwind
  }
  assert.deepEqual(switchOptions(wp), optionsBefore);
  assert.equal(siteRun().isEmpty(), true);
});
