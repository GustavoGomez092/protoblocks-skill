import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { upsertMenu, refreshMenus, NAV_BACKUP_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/navigation.mjs';
import { initState, loadState, updateState, setPath } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { createWp, WpError } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

// Fake wp: records (cmd, payload) for evalFilePayload and answers from a per-command queue.
function fakeWp(results = {}) {
  const calls = [];
  return {
    calls,
    evalFile() { throw new Error('navigation must pass data through evalFilePayload'); },
    evalFilePayload(script, cmd, data) {
      calls.push({ script, cmd, data: structuredClone(data) });
      const q = results[cmd] ?? [];
      const r = q.shift();
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
const theme = () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navunit-'));
  initState(t, { url: 'http://x.local', path: '/x' });
  return t;
};
const phpFail = (code, msg) => new WpError(['eval-file'], { code: 1, stdout: '', stderr: `[${code}] ${msg}\n` });

test('upsertMenu sends key, spec, expectHash and force through a payload (never argv)', () => {
  const wp = fakeWp({ upsert: [{ id: 5, key: 'primary', created: true, pending: [], contentHash: 'h1' }] });
  const spec = { title: 'P', items: [{ label: 'He said "hi" <b>', url: 'https://x' }] };
  const r = upsertMenu(wp, 'primary', spec, { expectHash: 'h0' });
  assert.equal(r.id, 5);
  assert.match(wp.calls[0].script, /navigation\.php$/);
  assert.equal(wp.calls[0].cmd, 'upsert');
  assert.deepEqual(wp.calls[0].data, { key: 'primary', spec, expectHash: 'h0', force: false });
});

test('upsertMenu maps PHP [EEDITED] to an EEDITED error explaining the Site Editor edit and --force', () => {
  const wp = fakeWp({ upsert: [phpFail('EEDITED', 'Menu "primary" (wp_navigation 5) changed since protoblocks last wrote it.')] });
  assert.throws(() => upsertMenu(wp, 'primary', { items: [] }, { expectHash: 'old' }), (e) => {
    assert.equal(e.code, 'EEDITED');
    assert.match(e.message, /Site Editor/);
    assert.match(e.message, /--force/);
    assert.match(e.message, /backups/);
    return true;
  });
});

test('upsertMenu with force saves the current menu content to a backup file first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navbak-'));
  const wp = fakeWp({ get: [{ id: 5, content: '<!-- wp:navigation-link {"label":"Edited"} /-->', contentHash: 'x' }], upsert: [{ id: 5, key: 'primary', created: false, pending: [], contentHash: 'h2' }] });
  const r = upsertMenu(wp, 'primary', { items: [] }, { force: true, backupDir: dir });
  assert.deepEqual(wp.calls.map((c) => c.cmd), ['get', 'upsert']);
  assert.equal(wp.calls[1].data.force, true);
  assert.match(path.basename(r.backup), /^nav-primary-\d{4}-\d{2}-\d{2}T.*\.html$/);
  assert.equal(path.dirname(r.backup), dir);
  assert.equal(fs.readFileSync(r.backup, 'utf8'), '<!-- wp:navigation-link {"label":"Edited"} /-->');
});

test('upsertMenu force without a backup dir is refused before touching WP', () => {
  const wp = fakeWp();
  assert.throws(() => upsertMenu(wp, 'primary', { items: [] }, { force: true }), (e) => e.code === 'EUSAGE');
  assert.equal(wp.calls.length, 0);
});

test('upsertMenu force with no existing menu writes no backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navbak-'));
  const wp = fakeWp({ get: [{ id: null, content: '', contentHash: null }], upsert: [{ id: 7, key: 'k', created: true, pending: [], contentHash: 'h' }] });
  const r = upsertMenu(wp, 'k', { items: [] }, { force: true, backupDir: dir });
  assert.equal(r.backup, undefined);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('refreshMenus only patches pending links (refresh command), records the new hash and keeps the spec', () => {
  const t = theme();
  const specA = { items: [{ label: 'A', page: 'a' }, { label: 'B', page: 'b' }] };
  const specB = { items: [{ label: 'C', page: 'c' }] };
  updateState(t, (s) => {
    setPath(s, 'site.navigation.menus.a', { id: 1, spec: specA, pending: [{ label: 'A', page: 'a' }, { label: 'B', page: 'b' }], contentHash: 'old' });
    setPath(s, 'site.navigation.menus.b', { id: 2, spec: specB, pending: [], contentHash: 'hb' });
  });
  const wp = fakeWp({ refresh: [{ id: 1, key: 'a', patched: [{ label: 'A', page: 'a' }], pending: [{ label: 'B', page: 'b' }], missing: [], contentHash: 'new' }] });
  const r = refreshMenus(wp, t);
  assert.deepEqual(r.refreshed, ['a']);
  assert.deepEqual(r.menus.a.patched, [{ label: 'A', page: 'a' }]);
  assert.deepEqual(wp.calls.map((c) => c.cmd), ['refresh']);
  assert.deepEqual(wp.calls[0].data, { key: 'a', pending: [{ label: 'A', page: 'a' }, { label: 'B', page: 'b' }] });
  const menus = loadState(t).site.navigation.menus;
  assert.deepEqual(menus.a, { id: 1, spec: specA, pending: [{ label: 'B', page: 'b' }], contentHash: 'new' });
  assert.deepEqual(menus.b, { id: 2, spec: specB, pending: [], contentHash: 'hb' });
});

test('refreshMenus drops pending links that were removed in the Site Editor and reports them', () => {
  const t = theme();
  updateState(t, (s) => { setPath(s, 'site.navigation.menus.a', { id: 1, spec: { items: [] }, pending: [{ label: 'A', page: 'a' }], contentHash: 'h' }); });
  const wp = fakeWp({ refresh: [{ id: 1, key: 'a', patched: [], pending: [], missing: [{ label: 'A', page: 'a' }], contentHash: 'h' }] });
  const r = refreshMenus(wp, t);
  assert.deepEqual(r.menus.a.missing, [{ label: 'A', page: 'a' }]);
  assert.deepEqual(loadState(t).site.navigation.menus.a.pending, []);
});

test('refreshMenus with no navigation state refreshes nothing', () => {
  assert.deepEqual(refreshMenus(fakeWp(), theme()).refreshed, []);
});

test('upsertMenu rejects invalid keys with ENAVKEY before calling WP', () => {
  for (const bad of ['', 'Has Space', 'UPPER', '../x', 'a/b', 'a.b', '--exec=1', undefined, 5]) {
    const wp = fakeWp();
    assert.throws(() => upsertMenu(wp, bad, { items: [] }), (e) => e.code === 'ENAVKEY', `key ${JSON.stringify(bad)}`);
    assert.equal(wp.calls.length, 0);
  }
  const ok = fakeWp({ upsert: [{ id: 1, key: 'a_b-1', created: true, pending: [], contentHash: 'h' }] });
  assert.equal(upsertMenu(ok, 'a_b-1', { items: [] }).id, 1);
});

test('NAV_BACKUP_DIR lives under the theme .protoblocks/artifacts/backups', () => {
  assert.equal(NAV_BACKUP_DIR('/t'), path.join('/t', '.protoblocks', 'artifacts', 'backups'));
});

test('upsertMenu goes through the real createWp payload path (no positional data)', () => {
  let args;
  const exec = (cmd, a) => { args = a; return { code: 0, stdout: '{"id":3,"key":"k","created":true,"pending":[],"contentHash":"h"}\n', stderr: '' }; };
  const wp = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec });
  upsertMenu(wp, 'k', { items: [{ label: '--exec=boom', url: '--require=x' }] });
  assert.equal(args.length, 4);
  assert.equal(args[2], 'upsert');
  assert.ok(!args.some((a) => a.startsWith('-')));
});

test('CLI upsert without a spec file prints usage and exits 64', () => {
  const script = fileURLToPath(new URL('../../skills/protoblocks-site-builder/scripts/lib/navigation.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, 'upsert', os.tmpdir(), 'primary'], { encoding: 'utf8' });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /Usage/);
});
