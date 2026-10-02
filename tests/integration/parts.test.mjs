import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { listOverrides, removeOverride } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';
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
    if (theme === fakeTheme) terms.add(theme);
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
  const r = removeOverride(wp, THEME, h.probe, { confirm: true });
  assert.deepEqual(r.removed, [], 'other theme override must not be removed');
  assert.equal(h.status(other), 'publish', 'other theme override untouched');
}));

itest('same probe slug in pb-itest and another theme: only the pb-itest post is trashed', () => withTheme(async (wp, h) => {
  const mine = h.create(h.probe, THEME);
  const other = h.create(h.probe, h.fakeTheme);
  const found = listOverrides(wp, THEME).filter((o) => o.slug === h.probe);
  assert.deepEqual(found.map((o) => o.id), [Number(mine)]);
  assert.equal(found[0].theme, THEME);

  assert.throws(() => removeOverride(wp, THEME, h.probe, {}), (e) => e.code === 'ECONFIRM' && e.rows.length === 1 && e.rows[0].id === Number(mine));
  assert.equal(h.status(mine), 'publish', 'still there without confirm');

  const r = removeOverride(wp, THEME, h.probe, { confirm: true });
  assert.deepEqual(r.removed, [Number(mine)]);
  assert.deepEqual(r.records.map((x) => x.id), [Number(mine)]);
  assert.equal(h.status(mine), 'trash', 'moved to Trash, recoverable');
  assert.equal(h.status(other), 'publish', 'other theme post untouched');
  assert.deepEqual(listOverrides(wp, THEME).filter((o) => o.id === Number(mine)), [], 'trashed post is no longer an override');
}));

itest('parts.php itself guards theme, slug, confirm and ambiguity', () => withTheme(async (wp, h) => {
  const mine = h.create(h.probe, THEME);
  assert.throws(() => wp.evalFile(PARTS_PHP, ['overrides', 'pb-not-active']), /ETHEMEMISMATCH/);
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', 'pb-not-active', h.probe, 'confirm']), /ETHEMEMISMATCH/);
  for (const bad of ['Header', ' header', 'a/b']) {
    assert.throws(() => wp.evalFile(PARTS_PHP, ['preview', THEME, bad]), /ESLUG/, bad);
  }
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe]), /ECONFIRM/);
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe, 'yes']), /ECONFIRM/);
  assert.equal(h.status(mine), 'publish', 'nothing removed by refused calls');

  // Force a duplicate slug within the same theme.
  const dup = h.create(`${h.probe}-dup`, THEME);
  wp.check(['eval', `global $wpdb; $wpdb->update($wpdb->posts, ['post_name' => '${h.probe}'], ['ID' => ${Number(dup)}]); clean_post_cache(${Number(dup)});`]);
  assert.throws(() => wp.evalFile(PARTS_PHP, ['remove-override', THEME, h.probe, 'confirm']), /EAMBIGUOUS/);
  assert.throws(() => removeOverride(wp, THEME, h.probe, { confirm: true }), (e) => /EAMBIGUOUS/.test(e.message));
  assert.equal(h.status(mine), 'publish');
  assert.equal(h.status(dup), 'publish');
}));

itest('serializeAttrs matches WordPress serialize_block_attributes', () => {
  const wp = testWp();
  const attrs = { a: '--><script>&"x"</script>', b: ['<', '>'], c: { d: 'q"--"' }, e: 1, f: true };
  const b64 = Buffer.from(JSON.stringify(attrs)).toString('base64');
  const php = wp.check(['eval', `echo serialize_block_attributes(json_decode(base64_decode("${b64}"), true));`]);
  assert.equal(serializeAttrs(attrs), php);
});
