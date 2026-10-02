import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itest, testWp, trackPost, untrackPosts } from './helpers.mjs';
import { upsertMenu, refreshMenus } from '../../skills/protoblocks-site-builder/scripts/lib/navigation.mjs';
import { initState, loadState, updateState, setPath } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

// SAFETY: every post this file creates or deletes has a unique per-test name: menu key "it<hex>"
// (post slug pb-nav-it<hex>) and pages "pb-itest-nav-<hex>-*". purge() only deletes those exact names.
function fixture(wp) {
  const hex = crypto.randomBytes(4).toString('hex');
  const key = `it${hex}`;
  const page = (n) => `pb-itest-nav-${hex}-${n}`;
  const names = [];
  const tmpDirs = [];
  // The run manifest gets every name before the post exists (recovery deletes exactly these names and types).
  for (const name of [`pb-nav-${key}`, `pb-nav-${key}__trashed`]) trackPost({ type: 'wp_navigation', name });
  const ids = (type, name) => wp.check(['post', 'list', `--post_type=${type}`, `--name=${name}`, '--post_status=any', '--format=ids']).trim().split(/\s+/).filter(Boolean);
  const createPage = (n, extra = []) => {
    names.push(page(n));
    trackPost({ type: 'page', name: page(n) });
    return wp.check(['post', 'create', '--post_type=page', '--post_status=publish', `--post_title=PB Itest Nav ${n}`, `--post_name=${page(n)}`, ...extra, '--porcelain']).trim();
  };
  const purge = () => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    for (const [type, name] of [...names.map((n) => ['page', n]), ['wp_navigation', `pb-nav-${key}`], ['wp_navigation', `pb-nav-${key}__trashed`]]) {
      assert.match(name, new RegExp(`${hex}`), 'purge only touches this test\'s unique names');
      const found = ids(type, name);
      if (found.length) wp.check(['post', 'delete', ...found, '--force']);
      untrackPosts((p) => p.type === type && p.name === name);
    }
  };
  const get = () => wp.evalFilePayload(path.join(WP_SCRIPTS_DIR, 'navigation.php'), 'get', { key });
  const stateDir = () => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navstate-'));
    tmpDirs.push(t);
    initState(t, { url: 'http://proto-blocks.local', path: '/x' });
    return t;
  };
  const remember = (t, spec, r) => updateState(t, (s) => { setPath(s, `site.navigation.menus.${key}`, { id: r.id, spec, pending: r.pending, contentHash: r.contentHash }); });
  return { hex, key, page, createPage, purge, get, stateDir, remember, names, tmpDirs };
}

itest('menus upsert idempotently and pending page links resolve on refresh', () => {
  const wp = testWp();
  const f = fixture(wp);
  try {
    const homeId = f.createPage('home');
    const label = `Q "quoted" & <b>bold</b> it's`;
    const spec = { title: 'Primary', items: [
      { label: 'Home', page: f.page('home') },
      { label: 'Later', page: f.page('later') },
      { label, url: 'https://example.com', children: [{ label: 'Docs', url: 'https://example.com/docs', opensInNewTab: true }] },
    ] };

    const a = upsertMenu(wp, f.key, spec);
    const b = upsertMenu(wp, f.key, spec);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.id, b.id);
    assert.equal(a.contentHash, b.contentHash);
    assert.deepEqual(b.pending, [{ label: 'Later', page: f.page('later') }]);
    assert.equal(wp.check(['post', 'list', '--post_type=wp_navigation', `--name=pb-nav-${f.key}`, '--post_status=any', '--format=count']).trim(), '1');
    const content = f.get().content;
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), b.contentHash, 'contentHash is sha256 of post_content');
    assert.match(content, new RegExp(`"id":${homeId}`));
    assert.match(content, /"kind":"post-type"/);
    assert.match(content, /wp:navigation-submenu/);
    assert.match(content, /"opensInNewTab":true/);

    // content must parse back (parse_blocks, via wp eval) into the same tree; labels round-trip
    const tree = JSON.parse(wp.check(['eval',
      `$p = get_posts(["post_type"=>"wp_navigation","name"=>"pb-nav-${f.key}","numberposts"=>1,"post_status"=>"any"])[0];` +
      '$f = function($bs) use (&$f) { $o = []; foreach ($bs as $b) { if ($b["blockName"] === null) continue; $o[] = ["n"=>$b["blockName"],"a"=>$b["attrs"],"c"=>$f($b["innerBlocks"])]; } return $o; };' +
      'echo wp_json_encode($f(parse_blocks($p->post_content)));']).trim().split('\n').at(-1));
    assert.deepEqual(tree.map((t) => t.n), ['core/navigation-link', 'core/navigation-link', 'core/navigation-submenu']);
    assert.equal(tree[0].a.label, 'Home');
    assert.equal(tree[0].a.id, Number(homeId));
    assert.equal(tree[2].a.label, label);
    assert.equal(tree[2].c.length, 1);
    assert.equal(tree[2].c[0].n, 'core/navigation-link');
    assert.equal(tree[2].c[0].a.opensInNewTab, true);

    const theme = f.stateDir();
    f.remember(theme, spec, b);
    f.createPage('later');
    assert.deepEqual(refreshMenus(wp, theme).refreshed, [f.key]);
    const menu = loadState(theme).site.navigation.menus[f.key];
    assert.deepEqual(menu.pending, []);
    assert.equal(menu.id, a.id);
    const after = f.get();
    assert.equal(after.contentHash, menu.contentHash);
    assert.equal((after.content.match(/"kind":"post-type"/g) ?? []).length, 2);
    assert.deepEqual(refreshMenus(wp, theme).refreshed, []);
  } finally {
    f.purge();
  }
});

itest('trashed menus are reused (not duplicated) and get uses the same lookup', () => {
  const wp = testWp();
  const f = fixture(wp);
  try {
    const spec = { title: 'Primary', items: [{ label: 'X', url: 'https://example.com' }] };
    const a = upsertMenu(wp, f.key, spec);
    wp.check(['eval', `wp_trash_post(${a.id});`]); // wp-cli refuses to trash wp_navigation; WP core trashes it (slug gets __trashed)
    assert.equal(wp.check(['post', 'get', String(a.id), '--field=post_status']).trim(), 'trash');
    assert.equal(f.get().id, a.id);
    const b = upsertMenu(wp, f.key, spec);
    assert.equal(b.id, a.id);
    assert.equal(b.created, false);
    assert.equal(wp.check(['post', 'get', String(b.id), '--field=post_status']).trim(), 'publish');
    assert.equal(wp.check(['post', 'list', '--post_type=wp_navigation', '--post_status=any', `--name=pb-nav-${f.key}`, '--format=count']).trim(), '1');
    assert.equal(wp.check(['post', 'list', '--post_type=wp_navigation', '--post_status=any', `--name=pb-nav-${f.key}-2`, '--format=count']).trim(), '0');
  } finally {
    f.purge();
  }
});

itest('only published pages resolve; nested slugs resolve', () => {
  const wp = testWp();
  const f = fixture(wp);
  try {
    f.names.push(f.page('draft'));
    const draftId = wp.check(['post', 'create', '--post_type=page', '--post_status=draft', '--post_title=PB Itest Nav Draft', `--post_name=${f.page('draft')}`, '--porcelain']).trim();
    const parentId = f.createPage('parent');
    const childId = f.createPage('child', [`--post_parent=${parentId}`]);
    const spec = { title: 'Primary', items: [
      { label: 'Draft', page: f.page('draft') },
      { label: 'Child', page: `${f.page('parent')}/${f.page('child')}` },
    ] };
    const a = upsertMenu(wp, f.key, spec);
    assert.deepEqual(a.pending, [{ label: 'Draft', page: f.page('draft') }]);
    const c1 = f.get().content;
    assert.doesNotMatch(c1, new RegExp(`"id":${draftId}`));
    assert.match(c1, new RegExp(`"id":${childId},[^}]*"kind":"post-type"`));
    assert.equal((c1.match(/"kind":"post-type"/g) ?? []).length, 1);

    const theme = f.stateDir();
    f.remember(theme, spec, a);
    wp.check(['post', 'update', draftId, '--post_status=publish']);
    assert.deepEqual(refreshMenus(wp, theme).refreshed, [f.key]);
    assert.deepEqual(loadState(theme).site.navigation.menus[f.key].pending, []);
    const c2 = f.get().content;
    assert.match(c2, new RegExp(`"id":${draftId}`));
    assert.equal((c2.match(/"kind":"post-type"/g) ?? []).length, 2);
  } finally {
    f.purge();
  }
});

itest('Site Editor edits survive: upsert refuses (EEDITED), refresh patches only pending links, force backs up first', () => {
  const wp = testWp();
  const f = fixture(wp);
  try {
    const spec = { title: 'Primary', items: [{ label: 'Later', page: f.page('later') }, { label: 'Ext', url: 'https://example.com' }] };
    const a = upsertMenu(wp, f.key, spec);
    const theme = f.stateDir();
    f.remember(theme, spec, a);

    // Simulate a Site Editor edit: the user adds a link and renames another.
    wp.check(['eval', `kses_remove_filters(); $p = get_post(${Number(a.id)}); wp_update_post(wp_slash(['ID' => $p->ID, 'post_content' => str_replace('"label":"Ext"', '"label":"Ext (edited)"', $p->post_content) . '<!-- wp:navigation-link {"label":"Edited","url":"https://edited.example","kind":"custom"} /-->']));`]);
    const edited = f.get();
    assert.match(edited.content, /Edited/);

    assert.throws(() => upsertMenu(wp, f.key, spec, { expectHash: a.contentHash }), (e) => e.code === 'EEDITED' && /Site Editor/.test(e.message));
    assert.equal(f.get().content, edited.content, 'refused upsert changed nothing');

    f.createPage('later');
    const r = refreshMenus(wp, theme);
    assert.deepEqual(r.menus[f.key].patched, [{ label: 'Later', page: f.page('later') }]);
    const patched = f.get().content;
    assert.match(patched, /"label":"Edited"/, 'added link kept');
    assert.match(patched, /"label":"Ext \(edited\)"/, 'renamed link kept');
    assert.match(patched, /"kind":"post-type"/, 'pending link converted');
    // The stored hash must NOT advance over the Site Editor edits: a plain upsert with state's hash still refuses.
    const stored = loadState(theme).site.navigation.menus[f.key];
    assert.equal(stored.contentHash, a.contentHash, 'refresh keeps the hash protoblocks last wrote');
    assert.notEqual(stored.contentHash, f.get().contentHash);
    assert.deepEqual(stored.pending, []);
    assert.throws(() => upsertMenu(wp, f.key, spec, { expectHash: stored.contentHash }), (e) => e.code === 'EEDITED');
    assert.equal(f.get().content, patched, 'refused upsert after refresh changed nothing');

    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navbak-'));
    f.tmpDirs.push(backupDir);
    const forced = upsertMenu(wp, f.key, spec, { expectHash: 'stale', force: true, backupDir });
    assert.equal(fs.readFileSync(forced.backup, 'utf8'), patched, 'backup holds the edited menu');
    assert.doesNotMatch(f.get().content, /Edited/);
  } finally {
    f.purge();
  }
});
