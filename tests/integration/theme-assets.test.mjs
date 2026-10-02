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

itest('managed assets enqueue assets/css/pb-shell.css after global-styles when WordPress registers it', async () => {
  const wp = testWp();
  const theme = await useItestTheme(wp);
  try {
    installThemeAssets(theme);
    assert.ok(fs.existsSync(path.join(theme, 'assets/css/pb-shell.css')), 'installThemeAssets copies pb-shell.css');
    const out = JSON.parse(wp.check(['eval', [
      'do_action("wp_enqueue_scripts");',
      '$s = wp_styles()->registered["pb-shell"] ?? null;',
      'echo wp_json_encode(["enqueued" => wp_style_is("pb-shell", "enqueued"), "src" => $s ? $s->src : null, "deps" => $s ? $s->deps : null, "globalStyles" => wp_style_is("global-styles", "registered")]);',
    ].join(' ')]));
    assert.equal(out.enqueued, true, JSON.stringify(out));
    assert.match(out.src, /\/pb-itest\/assets\/css\/pb-shell\.css$/);
    assert.deepEqual(out.deps, out.globalStyles ? ['global-styles'] : [], 'depends on global-styles exactly when it is registered');
    // The other branch, whatever the site's global-styles setting: registered before the hook runs (as core does at 10).
    const withGs = JSON.parse(wp.check(['eval', 'wp_register_style("global-styles", false); do_action("wp_enqueue_scripts"); echo wp_json_encode(wp_styles()->registered["pb-shell"]->deps);']));
    assert.deepEqual(withGs, ['global-styles']);
  } finally { restoreTheme(wp); }
});
