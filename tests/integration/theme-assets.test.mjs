import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { installThemeAssets } from '../../skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs';

itest('managed assets load in WordPress and enqueue pb-*.js', async () => {
  const wp = testWp();
  const theme = await useItestTheme(wp);
  try {
  installThemeAssets(theme);
  fs.mkdirSync(path.join(theme, 'assets/js'), { recursive: true });
  fs.writeFileSync(path.join(theme, 'assets/js/pb-itest.js'), '// itest');
  const out = wp.check(['eval', 'do_action("wp_enqueue_scripts"); echo wp_script_is("pb-itest", "enqueued") ? "yes" : "no";']).trim();
  assert.equal(out, 'yes');
  fs.rmSync(path.join(theme, 'assets/js/pb-itest.js'));
  } finally { restoreTheme(wp); }
});
