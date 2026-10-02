import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { listOverrides, removeOverride, recoveryCommand } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';
import { serializeAttrs } from '../../skills/protoblocks-site-builder/scripts/lib/blocks.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

// SAFETY: every destructive call below targets ONLY a unique throwaway probe slug (pb-itest-probe-<random>),
// either in the throwaway "pb-itest" theme or a made-up theme slug, and only posts whose IDs this file created.
// Never list-and-remove "all overrides" and never use a real slug such as header/footer.
const PARTS_PHP = path.join(WP_SCRIPTS_DIR, 'parts.php');
const rand = () => crypto.randomBytes(4).toString('hex');
const THEME = 'pb-itest';

function harness(wp) {
  const ids = [];
  const terms = new Set();
  const probe = `pb-itest-probe-${rand()}`;
  const fakeTheme = `pb-itest-other-${rand()}`;
  const create = (slug, theme) => {
    const id = wp.check(['post', 'create', '--post_type=wp_template_part', '--post_status=publish', `--post_name=${slug}`, `--post_title=${slug}`, '--post_content=x', '--porcelain']).trim();
    ids.push(id);
    terms.add(fakeTheme);
    wp.check(['post', 'term', 'set', id, 'wp_theme', theme]);
    // WordPress may suffix the slug at insert time; pin the exact probe slug.
    wp.check(['eval', `global $wpdb; $wpdb->update($wpdb->posts, ['post_name' => '${slug}'], ['ID' => ${Number(id)}]); clean_post_cache(${Number(id)});`]);
    return id;
  };
  const status = (id) => wp.check(['post', 'get', id, '--field=post_status']).trim();
  const cleanup = () => {
    for (const id of ids) wp.run(['post', 'delete', id, '--force']);
    for (const t of terms) wp.run(['term', 'delete', 'wp_theme', t, '--by=slug']);
  };
  return { probe, fakeTheme, create, status, cleanup };
}

const withTheme = async (fn) => {
  const wp = testWp();
  await useItestTheme(wp);
  const h = harness(wp);
  try {
    assert.equal(wp.check(['option', 'get', 'stylesheet']).trim(), THEME);
    await fn(wp, h);
  } finally {
    try { h.cleanup(); } finally { restoreTheme(wp); }
  }
};

// Canary FIRST: a probe in a different theme must be invisible to, and untouched by, pb-itest queries.
itest('canary: override queries and removal are scoped to the active theme', () => withTheme(async (wp, h) => {
  const other = h.create(h.probe, h.fakeTheme);
  assert.deepEqual(listOverrides(wp, THEME).filter((o) => o.slug === h.probe), [], 'other theme override must not be listed');
  const r = removeOverride(wp, THEME, h.probe, { confirm: true, expectId: Number(other) });
  assert.deepEqual(r.removed, [], 'other theme override must not be removed');
  // And PHP's own remove path, called directly with the other theme's real ID, must not touch it either.
  assert.deepEqual(wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe, 'confirm', other]).removed, []);
  assert.equal(h.status(other), 'publish', 'other theme override untouched');
}));

itest('same probe slug in pb-itest and another theme: only the pb-itest post is trashed', () => withTheme(async (wp, h) => {
  const mine = h.create(h.probe, THEME);
  const other = h.create(h.probe, h.fakeTheme);
  const found = listOverrides(wp, THEME).filter((o) => o.slug === h.probe);
  assert.deepEqual(found.map((o) => o.id), [Number(mine)]);
  assert.equal(found[0].theme, THEME, 'row theme comes from the post terms');

  assert.throws(() => removeOverride(wp, THEME, h.probe, {}), (e) => e.code === 'ECONFIRM' && e.rows.length === 1 && e.rows[0].id === Number(mine));
  assert.equal(h.status(mine), 'publish', 'still there without confirm');

  assert.throws(() => removeOverride(wp, THEME, h.probe, { confirm: true }), (e) => e.code === 'ECONFIRM', 'confirm without the previewed id');
  assert.throws(() => removeOverride(wp, THEME, h.probe, { confirm: true, expectId: Number(other) }), (e) => e.code === 'ESTALE', 'id of another post');
  assert.equal(h.status(mine), 'publish');
  assert.equal(h.status(other), 'publish');

  const r = removeOverride(wp, THEME, h.probe, { confirm: true, expectId: Number(mine) });
  assert.deepEqual(r.removed, [Number(mine)]);
  assert.deepEqual(r.records.map((x) => x.id), [Number(mine)]);
  assert.deepEqual(r.recovery, [recoveryCommand(mine)]);
  assert.equal(h.status(mine), 'trash', 'moved to Trash, recoverable');
  assert.equal(h.status(other), 'publish', 'other theme post untouched');
  assert.deepEqual(listOverrides(wp, THEME).filter((o) => o.id === Number(mine)), [], 'trashed post is no longer an override');

  // The advertised recovery works (wp_untrash_post + republish).
  wp.check(['eval', `wp_untrash_post(${Number(mine)});`]);
  wp.check(['post', 'update', mine, '--post_status=publish']);
  assert.equal(h.status(mine), 'publish');
  assert.deepEqual(listOverrides(wp, THEME).filter((o) => o.id === Number(mine)).map((o) => o.id), [Number(mine)]);
}));

itest('parts.php itself guards theme, slug, confirm and ambiguity', () => withTheme(async (wp, h) => {
  const mine = h.create(h.probe, THEME);
  assert.throws(() => listOverrides(wp, 'pb-not-active'), (e) => e.code === 'ETHEMEMISMATCH');
  assert.throws(() => wp.evalFile(PARTS_PHP, ['overrides', 'pb-not-active']), /ETHEMEMISMATCH/);
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', 'pb-not-active', h.probe, 'confirm', mine]), /ETHEMEMISMATCH/);
  for (const bad of ['Header', ' header', 'a/b']) {
    assert.throws(() => wp.evalFile(PARTS_PHP, ['preview', THEME, bad]), /ESLUG/, bad);
  }
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe]), /ECONFIRM/);
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe, 'yes', mine]), /ECONFIRM/);
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe, 'confirm']), /ECONFIRM/, 'missing id');
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe, 'confirm', 'abc']), /ECONFIRM/, 'non-numeric id');
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe, 'confirm', String(Number(mine) + 1)]), /ESTALE/);
  // ENOTRASH via a PHP-level seam (filter), not reachable from argv: simulate trash disabled.
  const run = `add_filter('protoblocks_parts_trash_days', '__return_zero'); $args = ['remove-override', '${THEME}', '${h.probe}', 'confirm', '${Number(mine)}']; include '${PARTS_PHP}';`;
  const r0 = wp.run(['eval', run]);
  assert.notEqual(r0.code, 0);
  assert.match(r0.stderr, /ENOTRASH/);
  assert.match(r0.stderr, /Clear customizations/);
  assert.equal(h.status(mine), 'publish', 'nothing removed by refused calls');

  // Force a duplicate slug within the same theme.
  const dup = h.create(`${h.probe}-dup`, THEME);
  wp.check(['eval', `global $wpdb; $wpdb->update($wpdb->posts, ['post_name' => '${h.probe}'], ['ID' => ${Number(dup)}]); clean_post_cache(${Number(dup)});`]);
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe, 'confirm', mine]), /EAMBIGUOUS/);
  assert.throws(() => removeOverride(wp, THEME, h.probe, { confirm: true, expectId: Number(mine) }), (e) => e.code === 'EAMBIGUOUS');
  assert.equal(h.status(mine), 'publish');
  assert.equal(h.status(dup), 'publish');
}));

itest('row theme comes from the real terms: a post tagged with two themes is refused', () => withTheme(async (wp, h) => {
  const mine = h.create(h.probe, THEME);
  wp.check(['post', 'term', 'set', mine, 'wp_theme', THEME, h.fakeTheme]);
  const row = listOverrides(wp, THEME).find((o) => o.id === Number(mine));
  assert.ok(row && row.theme.split(',').sort().join(',') === [THEME, h.fakeTheme].sort().join(','), `theme field lists real terms: ${row?.theme}`);
  assert.throws(() => removeOverride(wp, THEME, h.probe, { confirm: true, expectId: Number(mine) }), (e) => e.code === 'ETHEMEMISMATCH');
  assert.equal(h.status(mine), 'publish');
}));

// Pure computation, no posts touched: defines the helper by including parts.php with a harmless read-only command.
itest('trash-days filter can only tighten the guard', () => {
  const wp = testWp();
  const stylesheet = wp.check(['option', 'get', 'stylesheet']).trim();
  const php = (filterValue, constant) => `$args = ['overrides', '${stylesheet}']; ob_start(); include '${PARTS_PHP}'; ob_end_clean();
    add_filter('protoblocks_parts_trash_days', fn() => ${filterValue}, 99);
    echo protoblocks_parts_trash_days(${constant});`;
  const run = (f, c) => wp.check(['eval', php(f, c)]).trim();
  assert.equal(run(30, 0), '0', 'filter cannot loosen a disabled trash');
  assert.equal(run(0, 30), '0', 'filter can disable');
  assert.equal(run(5, 30), '5', 'filter can shorten');
  assert.equal(run(99, 30), '30', 'filter cannot lengthen');
});

itest('serializeAttrs matches WordPress serialize_block_attributes', () => {
  const wp = testWp();
  const attrs = { a: '--><script>&"x"</script>', b: ['<', '>'], c: { d: 'q"--"' }, e: 1, f: true };
  const b64 = Buffer.from(JSON.stringify(attrs)).toString('base64');
  const php = wp.check(['eval', `echo serialize_block_attributes(json_decode(base64_decode("${b64}"), true));`]);
  assert.equal(serializeAttrs(attrs), php);
});
