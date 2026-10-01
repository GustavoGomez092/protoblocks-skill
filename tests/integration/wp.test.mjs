import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from '../../skills/protoblocks-site-builder/scripts/lib/exec.mjs';
import { itest, testWp, SITE_URL, PUBLIC, useItestTheme, restoreTheme, ORIGINAL_THEME } from './helpers.mjs';

itest('runner talks to the Local test site', () => {
  assert.match(SITE_URL, /^https?:\/\//);
  assert.equal(testWp().check(['option', 'get', 'siteurl']).trim(), SITE_URL);
});

itest('useItestTheme activates a throwaway copy and restoreTheme puts the original back', async () => {
  const wp = testWp();
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
});
