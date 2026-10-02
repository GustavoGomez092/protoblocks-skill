import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { pageSpecFromState, buildPage } from '../../skills/protoblocks-site-builder/scripts/lib/page.mjs';

const PAGE_MJS = path.resolve('skills/protoblocks-site-builder/scripts/lib/page.mjs');

test('pageSpecFromState orders sections, adds anchors, skips skipped/unbuilt', () => {
  const state = { pages: [{ slug: 'home', title: 'Home', postId: 7, contentHash: 'abc', sections: [
    { n: 2, anchor: 'pb-s2', block: 'cta', attrs: { heading: 'Go' }, status: 'done' },
    { n: 1, anchor: 'pb-s1', block: 'hero-split', attrs: {}, inner: ['<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->'], status: 'building' },
    { n: 3, anchor: 'pb-s3', block: 'faq', status: 'skipped' },
    { n: 4, anchor: 'pb-s4', status: 'planned' },
  ] }] };
  const spec = pageSpecFromState(state, 'home');
  assert.equal(spec.postId, 7);
  assert.equal(spec.expectedHash, 'abc');
  assert.equal(spec.force, false);
  assert.deepEqual(spec.blocks.map((b) => b.name), ['proto-blocks/hero-split', 'proto-blocks/cta']);
  assert.deepEqual(spec.blocks[1].attrs, { heading: 'Go', anchor: 'pb-s2' });
  assert.match(spec.blocks[0].innerRaw, /wp:paragraph/);
  assert.throws(() => pageSpecFromState(state, 'nope'), /No page "nope"/);
});

test('pageSpecFromState keeps namespaced block names and passes force', () => {
  const state = { pages: [{ slug: 'p', sections: [{ n: 1, anchor: 'pb-s1', block: 'acme/x', status: 'done' }] }] };
  const spec = pageSpecFromState(state, 'p', { force: true });
  assert.equal(spec.blocks[0].name, 'acme/x');
  assert.equal(spec.force, true);
  assert.equal(spec.postId, null);
  assert.equal(spec.title, 'p');
});

// ---- buildPage with a fake WP-CLI -------------------------------------------------------------------------------
function setup({ pending = false, pageOverrides = {} } = {}) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pageunit-'));
  initState(theme, { url: 'http://x.test', path: '/x' });
  updateState(theme, (s) => {
    s.pages.push({ slug: 'home', title: 'Home', status: 'planning', postId: 7, contentHash: 'h-old', sections: [
      { n: 1, anchor: 'pb-s1', block: 'hero', attrs: {}, status: 'building' },
    ], ...pageOverrides });
    if (pending) s.site.navigation = { menus: { primary: { id: 1, spec: { items: [] }, pending: [{ label: 'Home', page: 'home' }] } } };
  });
  return theme;
}

function fake(handlers) {
  const calls = [];
  const exec = (cmd, args) => {
    const script = path.basename(args[1]);
    const sub = args[2];
    const spec = sub === 'write' || sub === 'plan' ? JSON.parse(fs.readFileSync(args[3], 'utf8')) : null;
    calls.push({ script, sub, spec, args });
    const h = handlers[`${script}:${sub}`];
    if (!h) throw new Error(`unexpected call ${script} ${sub}`);
    const out = typeof h === 'function' ? h(spec, args) : h;
    return { code: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '' };
  };
  return { wp: createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }), calls };
}

const okWrite = (over = {}) => ({ ok: true, postId: 7, slug: 'home', url: 'http://x.test/home/', contentHash: 'h-new', created: false, backupRevisionId: 31, warnings: [], ...over });
const plan = (over = {}) => ({ target: { postId: 7, hash: 'h-old', built: true, status: 'publish' }, guard: null, needsBackup: false, ...over });

test('buildPage writes through, records state, advances planning to building', () => {
  const theme = setup();
  const { wp, calls } = fake({ 'page.php:plan': plan(), 'page.php:write': okWrite() });
  const r = buildPage(wp, theme, 'home');
  assert.equal(r.postId, 7);
  assert.equal(r.contentHash, 'h-new');
  assert.equal(r.backupRevisionId, 31);
  assert.equal(r.backupFile, null);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.refreshedMenus, []);
  assert.deepEqual(calls.map((c) => c.sub), ['plan', 'write']);
  const p = loadState(theme).pages[0];
  assert.equal(p.contentHash, 'h-new');
  assert.equal(p.url, 'http://x.test/home/');
  assert.equal(p.status, 'building');
});

for (const code of ['EEDITED', 'ESLUGTAKEN', 'EFOREIGN']) {
  test(`guard ${code}: throws, names --force and the backup folder, writes nothing, leaves state alone`, () => {
    const theme = setup();
    const { wp, calls } = fake({ 'page.php:plan': plan({ guard: { code, message: `guard says ${code}`, currentHash: 'h-x' } }) });
    assert.throws(() => buildPage(wp, theme, 'home'), (e) => e.code === code && /guard says/.test(e.message) && /--force/.test(e.message)
      && e.message.includes(path.join(theme, '.protoblocks', 'artifacts', 'backups')));
    assert.deepEqual(calls.map((c) => c.sub), ['plan']);
    assert.equal(fs.existsSync(path.join(theme, '.protoblocks', 'artifacts', 'backups')), false);
    assert.equal(loadState(theme).pages[0].contentHash, 'h-old');
    assert.equal(loadState(theme).pages[0].status, 'planning');
  });
}

test('overwriting content that is not the builder\'s saves a backup file BEFORE the write call', () => {
  const theme = setup();
  let backupExistedAtWrite = null;
  const { wp, calls } = fake({
    'page.php:plan': plan({ needsBackup: true, target: { postId: 7, hash: 'h-hand', built: true, status: 'publish' } }),
    'page.php:get': { postId: 7, content: '<p>hand written ünï</p>', contentHash: 'h-hand', postType: 'page', status: 'publish', built: true },
    'page.php:write': () => {
      const dir = path.join(theme, '.protoblocks', 'artifacts', 'backups');
      backupExistedAtWrite = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      return okWrite({ backupRevisionId: null });
    },
  });
  const r = buildPage(wp, theme, 'home', { force: true });
  assert.equal(backupExistedAtWrite.length, 1);
  assert.match(r.backupFile, /backups[\\/]home-7-\d{4}-\d\d-\d\dT[\d-]+Z\.html$/);
  assert.equal(fs.readFileSync(r.backupFile, 'utf8'), '<p>hand written ünï</p>');
  assert.equal(r.backupRevisionId, null);
  assert.deepEqual(calls.map((c) => c.sub), ['plan', 'get', 'write']);
  assert.equal(calls[2].spec.force, true);
});

test('a failed backup write aborts before the overwrite', () => {
  const theme = setup();
  fs.mkdirSync(path.join(theme, '.protoblocks', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(theme, '.protoblocks', 'artifacts', 'backups'), 'a file where the dir should be');
  const { wp, calls } = fake({
    'page.php:plan': plan({ needsBackup: true }),
    'page.php:get': { postId: 7, content: 'x', contentHash: 'h', postType: 'page', status: 'publish', built: true },
  });
  assert.throws(() => buildPage(wp, theme, 'home', { force: true }), (e) => e.code === 'EBACKUP');
  assert.ok(!calls.some((c) => c.sub === 'write'));
});

test('typed PHP errors become Error with that code (EINPUT, ENOTPAGE)', () => {
  for (const code of ['EINPUT', 'ENOTPAGE']) {
    const theme = setup();
    const { wp } = fake({ 'page.php:plan': { error: { code, message: `bad ${code}` } } });
    assert.throws(() => buildPage(wp, theme, 'home'), (e) => e.code === code && e.message === `bad ${code}`);
  }
});

test('a final slug that differs from the requested one is reported as a warning', () => {
  const theme = setup({ pageOverrides: { postId: null, contentHash: null } });
  const { wp } = fake({ 'page.php:plan': plan({ target: null }), 'page.php:write': okWrite({ slug: 'home-2', created: true, backupRevisionId: null, warnings: ['pw'] }) });
  const r = buildPage(wp, theme, 'home');
  assert.equal(r.slug, 'home-2');
  assert.ok(r.warnings.includes('pw'));
  assert.ok(r.warnings.some((w) => /home-2/.test(w) && /"home"/.test(w)));
});

test('refreshMenus runs only when a pending link targets this slug; a failure is reported, not thrown', () => {
  const nav = { id: 1, key: 'primary', created: false, pending: [] };
  let n = 0;
  let theme = setup({ pending: true });
  let f = fake({ 'page.php:plan': plan(), 'page.php:write': okWrite(), 'navigation.php:upsert': () => { n++; return nav; } });
  assert.deepEqual(buildPage(f.wp, theme, 'home').refreshedMenus, ['primary']);
  assert.equal(n, 1);

  theme = setup({ pending: false });
  n = 0;
  f = fake({ 'page.php:plan': plan(), 'page.php:write': okWrite(), 'navigation.php:upsert': () => { n++; return nav; } });
  assert.deepEqual(buildPage(f.wp, theme, 'home').refreshedMenus, []);
  assert.equal(n, 0);

  theme = setup({ pending: true });
  updateState(theme, (s) => { s.site.navigation.menus.primary.pending = [{ label: 'X', page: 'other' }]; });
  f = fake({ 'page.php:plan': plan(), 'page.php:write': okWrite() });
  assert.deepEqual(buildPage(f.wp, theme, 'home').refreshedMenus, []);

  theme = setup({ pending: true });
  f = fake({ 'page.php:plan': plan(), 'page.php:write': okWrite(), 'navigation.php:upsert': () => { throw new Error('nav boom'); } });
  const r = buildPage(f.wp, theme, 'home');
  assert.deepEqual(r.refreshedMenus, []);
  assert.match(r.menuRefreshError, /nav boom|failed/);
  assert.equal(loadState(theme).pages[0].contentHash, 'h-new');
});

// ---- CLI --------------------------------------------------------------------------------------------------------
const cli = (...a) => spawnSync(process.execPath, [PAGE_MJS, ...a], { encoding: 'utf8' });

test('CLI: usage errors and unknown flags exit 64', () => {
  for (const a of [[], ['build'], ['build', '/t'], ['nope', '/t', 's'], ['build', '/t', 's', '--forse'], ['build', '/t', 's', 'extra']]) {
    const r = cli(...a);
    assert.equal(r.status, 64, JSON.stringify(a));
    assert.match(r.stderr, /Usage: node page\.mjs build/);
  }
});

test('CLI: runtime errors print [CODE] message and exit 1', () => {
  const r = cli('build', fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pagecli-')), 'home');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[[A-Z]+\] /);
});
