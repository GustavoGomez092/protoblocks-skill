import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { applyTokens, BODY_FONT_START } from '../../skills/protoblocks-site-builder/scripts/lib/tokens.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

itest('applied tokens reach theme.json, the body font and compile with Tailwind', async () => {
  const wp = testWp();
  const theme = await useItestTheme(wp);
  try {
  applyTokens(theme, { colors: { ink: '#101010', accent: '#ff5a1f' }, fonts: { sans: { family: 'Inter', google: [400, 700] }, display: { family: 'Fraunces', google: [600] } } });
  const palette = JSON.parse(wp.check(['eval', 'echo wp_json_encode(wp_get_global_settings(["color","palette","theme"]));']));
  assert.ok(palette.some((p) => p.slug === 'accent' && p.color === '#ff5a1f'), JSON.stringify(palette));
  // The body font: theme.json styles point at a preset variable WordPress actually defines.
  assert.equal(wp.check(['eval', 'echo wp_get_global_styles(["typography","fontFamily"]);']).trim(), 'var(--wp--preset--font-family--sans)');
  const css = wp.check(['eval', 'echo wp_get_global_stylesheet();']);
  assert.match(css, /--wp--preset--font-family--sans:\s*"Inter"/);
  assert.match(css, /font-family:\s*var\(--wp--preset--font-family--sans\)/);
  const style = fs.readFileSync(path.join(theme, 'style.css'), 'utf8');
  assert.ok(style.includes(BODY_FONT_START), 'body rule is managed');
  assert.match(style, /^body \{\n {2}font-family: "Inter", ui-sans-serif, system-ui, sans-serif;\n\}/m);
  const r = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'tailwind.php'), ['compile']);
  assert.equal(r.success, true, JSON.stringify(r));
  } finally { restoreTheme(wp); }
});

itest('self-hosted fonts: theme.json fontFace with file:./assets/fonts is printed by WordPress as @font-face', async () => {
  const wp = testWp();
  const theme = await useItestTheme(wp);
  try {
    fs.mkdirSync(path.join(theme, 'assets/fonts'), { recursive: true });
    fs.writeFileSync(path.join(theme, 'assets/fonts/pb-itest-font.woff2'), 'not a real font');
    const face = { fontFamily: 'PB Itest Sans', fontStyle: 'normal', fontWeight: '400', src: ['file:./assets/fonts/pb-itest-font.woff2'], fontDisplay: 'swap' };
    applyTokens(theme, { colors: { ink: '#101010' }, fonts: { sans: { family: 'PB Itest Sans', google: [400] } } }, { fontFaces: { 'PB Itest Sans': [face] } });
    const out = wp.check(['eval', 'wp_print_font_faces();']);
    assert.match(out, /@font-face\s*\{[^}]*font-family:\s*"?PB Itest Sans"?/, out);
    assert.match(out, /\/themes\/pb-itest\/assets\/fonts\/pb-itest-font\.woff2/, out);
    assert.doesNotMatch(fs.readFileSync(path.join(theme, 'style.css'), 'utf8'), /fonts\.googleapis\.com/);
  } finally {
    fs.rmSync(path.join(theme, 'assets/fonts/pb-itest-font.woff2'), { force: true });
    restoreTheme(wp);
  }
});
