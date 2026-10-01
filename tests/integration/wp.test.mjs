import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
    assert.ok(fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'style.css')), 'itest theme folder exists');
  } finally {
    restoreTheme(wp);
  }
  assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), ORIGINAL_THEME);
  assert.ok(fs.existsSync(path.join(PUBLIC, 'wp-content/themes', ORIGINAL_THEME)));
});
