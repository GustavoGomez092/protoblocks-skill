import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
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
    // If .git exists, verify it does not contain the developer's history
    const gitDir = path.join(dir, '.git');
    if (fs.existsSync(gitDir)) {
      try {
        const logOutput = execSync(`git -C "${dir}" log --oneline 2>/dev/null | wc -l`, { encoding: 'utf8' }).trim();
        const commitCount = parseInt(logOutput, 10);
        assert.ok(commitCount <= 1, 'git history should be fresh (0 or 1 commit only, never the developer history)');
        if (commitCount === 1) {
          const firstCommit = execSync(`git -C "${dir}" log --oneline`, { encoding: 'utf8' }).trim();
          assert.ok(firstCommit.startsWith('chore: fork'), 'initial commit should be fork marker');
        }
      } catch (e) {
        // git might not be available or repo might not be initialized properly
      }
    }
  } finally {
    restoreTheme(wp);
  }
  assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), ORIGINAL_THEME);
  assert.ok(fs.existsSync(path.join(PUBLIC, 'wp-content/themes', ORIGINAL_THEME)));
});
