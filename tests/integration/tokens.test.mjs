import assert from 'node:assert/strict';
import path from 'node:path';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { applyTokens } from '../../skills/protoblocks-site-builder/scripts/lib/tokens.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

itest('applied tokens reach theme.json and compile with Tailwind', async () => {
  const wp = testWp();
  const theme = await useItestTheme(wp);
  try {
  applyTokens(theme, { colors: { ink: '#101010', accent: '#ff5a1f' }, fonts: { sans: { family: 'Inter', google: [400, 700] } } });
  const palette = JSON.parse(wp.check(['eval', 'echo wp_json_encode(wp_get_global_settings(["color","palette","theme"]));']));
  assert.ok(palette.some((p) => p.slug === 'accent' && p.color === '#ff5a1f'), JSON.stringify(palette));
  const r = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['compile']);
  assert.equal(r.success, true, JSON.stringify(r));
  } finally { restoreTheme(wp); }
});
