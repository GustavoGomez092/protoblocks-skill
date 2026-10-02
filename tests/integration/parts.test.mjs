import assert from 'node:assert/strict';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { listOverrides, removeOverride } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';
import { serializeAttrs } from '../../skills/protoblocks-site-builder/scripts/lib/blocks.mjs';

// Runs on the throwaway pb-itest theme only — never touch the developer's real Site Editor overrides.
itest('detects a Site Editor header override and removes it only with confirm', async () => {
  const wp = testWp();
  await useItestTheme(wp);
  try {
  const theme = wp.check(['option', 'get', 'stylesheet']).trim();
  assert.equal(theme, 'pb-itest');
  for (const o of listOverrides(wp)) removeOverride(wp, o.slug, { confirm: true });
  const id = wp.check(['post', 'create', '--post_type=wp_template_part', '--post_status=publish', '--post_name=header', '--post_title=Header', '--post_content=<!-- wp:paragraph --><p>edited</p><!-- /wp:paragraph -->', '--porcelain']).trim();
  wp.check(['post', 'term', 'set', id, 'wp_theme', theme]);

  const found = listOverrides(wp);
  assert.deepEqual(found.map((o) => o.slug), ['header']);
  assert.throws(() => removeOverride(wp, 'header', {}), (e) => e.code === 'ECONFIRM');
  assert.equal(listOverrides(wp).length, 1, 'still there without confirm');
  assert.deepEqual(removeOverride(wp, 'header', { confirm: true }).removed, [Number(id)]);
  assert.equal(listOverrides(wp).length, 0);
  } finally { restoreTheme(wp); }
});

itest('override queries are scoped to the active theme', async () => {
  const wp = testWp();
  await useItestTheme(wp);
  let otherId = '';
  try {
    otherId = wp.check(['post', 'create', '--post_type=wp_template_part', '--post_status=publish', '--post_name=pb-scope-probe', '--post_title=Scope Probe', '--post_content=x', '--porcelain']).trim();
    wp.check(['post', 'term', 'set', otherId, 'wp_theme', 'pb-other-theme-xyz']);
    assert.deepEqual(listOverrides(wp), [], 'other theme override must not be listed');
    assert.deepEqual(removeOverride(wp, 'pb-scope-probe', { confirm: true }).removed, [], 'other theme override must not be removed');
    assert.ok(wp.check(['post', 'get', otherId, '--field=ID']).trim(), 'other theme override still exists');
  } finally {
    try {
      if (otherId) wp.run(['post', 'delete', otherId, '--force']);
      wp.run(['term', 'delete', 'wp_theme', 'pb-other-theme-xyz', '--by=slug']);
    } finally { restoreTheme(wp); }
  }
});

itest('serializeAttrs matches WordPress serialize_block_attributes', () => {
  const wp = testWp();
  const attrs = { a: '--><script>&"x"</script>', b: ['<', '>'], c: { d: 'q"--"' }, e: 1, f: true };
  const b64 = Buffer.from(JSON.stringify(attrs)).toString('base64');
  const php = wp.check(['eval', `echo serialize_block_attributes(json_decode(base64_decode("${b64}"), true));`]);
  assert.equal(serializeAttrs(attrs), php);
});
