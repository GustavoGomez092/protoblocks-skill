import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itest, testWp } from './helpers.mjs';
import { upsertMenu, refreshMenus } from '../../skills/protoblocks-site-builder/scripts/lib/navigation.mjs';
import { initState, loadState, updateState, setPath } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

const NAV = path.join(WP_SCRIPTS_DIR, 'navigation.php');
const ids = (wp, type, name) => wp.check(['post', 'list', `--post_type=${type}`, `--name=${name}`, '--post_status=any', '--format=ids']).trim().split(/\s+/).filter(Boolean);
const purge = (wp) => {
  for (const [type, name] of [['page', 'pb-nav-home'], ['page', 'pb-nav-later'], ['page', 'pb-nav-draft'], ['page', 'pb-nav-child'], ['page', 'pb-nav-parent'], ['wp_navigation', 'pb-nav-itest']]) {
    const found = ids(wp, type, name);
    if (found.length) wp.check(['post', 'delete', ...found, '--force']);
  }
};

itest('menus upsert idempotently and pending page links resolve on refresh', () => {
  const wp = testWp();
  purge(wp);
  try {
    const homeId = wp.check(['post', 'create', '--post_type=page', '--post_status=publish', '--post_title=PB Nav Home', '--post_name=pb-nav-home', '--porcelain']).trim();
    const label = `Q "quoted" & <b>bold</b> it's`;
    const spec = { title: 'Primary', items: [
      { label: 'Home', page: 'pb-nav-home' },
      { label: 'Later', page: 'pb-nav-later' },
      { label, url: 'https://example.com', children: [{ label: 'Docs', url: 'https://example.com/docs', opensInNewTab: true }] },
    ] };

    const a = upsertMenu(wp, 'itest', spec);
    const b = upsertMenu(wp, 'itest', spec);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.id, b.id);
    assert.deepEqual(b.pending, [{ label: 'Later', page: 'pb-nav-later' }]);
    assert.equal(wp.check(['post', 'list', '--post_type=wp_navigation', '--name=pb-nav-itest', '--post_status=any', '--format=count']).trim(), '1');
    const content = wp.evalFile(NAV, ['get', 'itest']).content;
    assert.match(content, new RegExp(`"id":${homeId}`));
    assert.match(content, /"kind":"post-type"/);
    assert.match(content, /wp:navigation-submenu/);
    assert.match(content, /"opensInNewTab":true/);

    // content must parse back (parse_blocks, via wp eval) into the same tree; labels round-trip
    const tree = JSON.parse(wp.check(['eval',
      '$p = get_posts(["post_type"=>"wp_navigation","name"=>"pb-nav-itest","numberposts"=>1,"post_status"=>"any"])[0];' +
      '$f = function($bs) use (&$f) { $o = []; foreach ($bs as $b) { if ($b["blockName"] === null) continue; $o[] = ["n"=>$b["blockName"],"a"=>$b["attrs"],"c"=>$f($b["innerBlocks"])]; } return $o; };' +
      'echo wp_json_encode($f(parse_blocks($p->post_content)));']).trim().split('\n').at(-1));
    assert.deepEqual(tree.map((t) => t.n), ['core/navigation-link', 'core/navigation-link', 'core/navigation-submenu']);
    assert.equal(tree[0].a.label, 'Home');
    assert.equal(tree[0].a.id, Number(homeId));
    assert.equal(tree[2].a.label, label);
    assert.equal(tree[2].c.length, 1);
    assert.equal(tree[2].c[0].n, 'core/navigation-link');
    assert.equal(tree[2].c[0].a.opensInNewTab, true);

    const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navstate-'));
    initState(theme, { url: 'http://proto-blocks.local', path: '/x' });
    updateState(theme, (s) => { setPath(s, 'site.navigation.menus.itest', { id: b.id, spec, pending: b.pending }); });
    wp.check(['post', 'create', '--post_type=page', '--post_status=publish', '--post_title=PB Nav Later', '--post_name=pb-nav-later', '--porcelain']);
    assert.deepEqual(refreshMenus(wp, theme).refreshed, ['itest']);
    const menu = loadState(theme).site.navigation.menus.itest;
    assert.deepEqual(menu.pending, []);
    assert.equal(menu.id, a.id);
    const after = wp.evalFile(NAV, ['get', 'itest']).content;
    assert.equal((after.match(/"kind":"post-type"/g) ?? []).length, 2);
    assert.deepEqual(refreshMenus(wp, theme).refreshed, []);
  } finally {
    purge(wp);
  }
});

itest('trashed menus are reused (not duplicated) and get uses the same lookup', () => {
  const wp = testWp();
  purge(wp);
  try {
    const spec = { title: 'Primary', items: [{ label: 'X', url: 'https://example.com' }] };
    const a = upsertMenu(wp, 'itest', spec);
    wp.check(['eval', `wp_trash_post(${a.id});`]); // wp-cli refuses to trash wp_navigation; WP core trashes it (slug gets __trashed)
    assert.equal(wp.check(['post', 'get', String(a.id), '--field=post_status']).trim(), 'trash');
    assert.equal(wp.evalFile(NAV, ['get', 'itest']).id, a.id);
    const b = upsertMenu(wp, 'itest', spec);
    assert.equal(b.id, a.id);
    assert.equal(b.created, false);
    assert.equal(wp.check(['post', 'get', String(b.id), '--field=post_status']).trim(), 'publish');
    assert.equal(wp.check(['post', 'list', '--post_type=wp_navigation', '--post_status=any', '--name=pb-nav-itest', '--format=count']).trim(), '1');
    assert.equal(wp.check(['post', 'list', '--post_type=wp_navigation', '--post_status=any', '--name=pb-nav-itest-2', '--format=count']).trim(), '0');
  } finally {
    purge(wp);
  }
});

itest('only published pages resolve; nested slugs resolve', () => {
  const wp = testWp();
  purge(wp);
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navstate-'));
  try {
    const draftId = wp.check(['post', 'create', '--post_type=page', '--post_status=draft', '--post_title=PB Nav Draft', '--post_name=pb-nav-draft', '--porcelain']).trim();
    const parentId = wp.check(['post', 'create', '--post_type=page', '--post_status=publish', '--post_title=PB Nav Parent', '--post_name=pb-nav-parent', '--porcelain']).trim();
    const childId = wp.check(['post', 'create', '--post_type=page', '--post_status=publish', `--post_parent=${parentId}`, '--post_title=PB Nav Child', '--post_name=pb-nav-child', '--porcelain']).trim();
    const spec = { title: 'Primary', items: [
      { label: 'Draft', page: 'pb-nav-draft' },
      { label: 'Child', page: 'pb-nav-parent/pb-nav-child' },
    ] };
    const a = upsertMenu(wp, 'itest', spec);
    assert.deepEqual(a.pending, [{ label: 'Draft', page: 'pb-nav-draft' }]);
    const c1 = wp.evalFile(NAV, ['get', 'itest']).content;
    assert.doesNotMatch(c1, new RegExp(`"id":${draftId}`));
    assert.match(c1, new RegExp(`"id":${childId},[^}]*"kind":"post-type"`));
    assert.equal((c1.match(/"kind":"post-type"/g) ?? []).length, 1);

    initState(theme, { url: 'http://proto-blocks.local', path: '/x' });
    updateState(theme, (s) => { setPath(s, 'site.navigation.menus.itest', { id: a.id, spec, pending: a.pending }); });
    wp.check(['post', 'update', draftId, '--post_status=publish']);
    assert.deepEqual(refreshMenus(wp, theme).refreshed, ['itest']);
    assert.deepEqual(loadState(theme).site.navigation.menus.itest.pending, []);
    const c2 = wp.evalFile(NAV, ['get', 'itest']).content;
    assert.match(c2, new RegExp(`"id":${draftId}`));
    assert.equal((c2.match(/"kind":"post-type"/g) ?? []).length, 2);
  } finally {
    purge(wp);
  }
});
