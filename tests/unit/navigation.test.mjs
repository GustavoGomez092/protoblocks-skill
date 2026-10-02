import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upsertMenu, refreshMenus } from '../../skills/protoblocks-site-builder/scripts/lib/navigation.mjs';
import { initState, loadState, updateState, setPath } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

function fakeWp(results) {
  const calls = [];
  return {
    calls,
    evalFile(script, args) {
      const spec = JSON.parse(fs.readFileSync(args[2], 'utf8'));
      calls.push({ script, args: [...args], spec });
      return results.shift();
    },
  };
}

test('upsertMenu passes upsert/key/spec file and removes the temp file', () => {
  const wp = fakeWp([{ id: 5, key: 'primary', created: true, pending: [] }]);
  const spec = { title: 'P', items: [{ label: 'He said "hi" <b>', url: 'https://x' }] };
  const r = upsertMenu(wp, 'primary', spec);
  assert.equal(r.id, 5);
  assert.match(wp.calls[0].script, /navigation\.php$/);
  assert.deepEqual(wp.calls[0].args.slice(0, 2), ['upsert', 'primary']);
  assert.deepEqual(wp.calls[0].spec, spec);
  assert.ok(!fs.existsSync(wp.calls[0].args[2]));
});

test('upsertMenu removes the temp file when wp throws', () => {
  const wp = { evalFile(_s, args) { wp.file = args[2]; throw new Error('boom'); } };
  assert.throws(() => upsertMenu(wp, 'k', { items: [] }), /boom/);
  assert.ok(!fs.existsSync(wp.file));
});

test('refreshMenus re-upserts only menus with pending links and records the result', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navunit-'));
  initState(theme, { url: 'http://x.local', path: '/x' });
  const specA = { items: [{ label: 'A', page: 'a' }] };
  const specB = { items: [{ label: 'B', page: 'b' }] };
  updateState(theme, (s) => {
    setPath(s, 'site.navigation.menus.a', { id: 1, spec: specA, pending: [{ label: 'A', page: 'a' }] });
    setPath(s, 'site.navigation.menus.b', { id: 2, spec: specB, pending: [] });
  });
  const still = [{ label: 'A', page: 'a' }];
  const wp = fakeWp([{ id: 9, key: 'a', created: false, pending: still }]);
  assert.deepEqual(refreshMenus(wp, theme), { refreshed: ['a'] });
  assert.equal(wp.calls.length, 1);
  assert.deepEqual(wp.calls[0].spec, specA);
  const menus = loadState(theme).site.navigation.menus;
  assert.equal(menus.a.id, 9);
  assert.deepEqual(menus.a.pending, still);
  assert.deepEqual(menus.a.spec, specA);
  assert.deepEqual(menus.b.pending, []);
});

test('refreshMenus with no navigation state refreshes nothing', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navunit-'));
  initState(theme, { url: 'http://x.local', path: '/x' });
  assert.deepEqual(refreshMenus(fakeWp([]), theme), { refreshed: [] });
});

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('upsertMenu rejects invalid keys with ENAVKEY before calling WP', () => {
  for (const bad of ['', 'Has Space', 'UPPER', '../x', 'a/b', 'a.b']) {
    const wp = fakeWp([]);
    assert.throws(() => upsertMenu(wp, bad, { items: [] }), (e) => e.code === 'ENAVKEY', `key ${JSON.stringify(bad)}`);
    assert.equal(wp.calls.length, 0);
  }
  const ok = fakeWp([{ id: 1, key: 'a_b-1', created: true, pending: [] }]);
  assert.equal(upsertMenu(ok, 'a_b-1', { items: [] }).id, 1);
});

test('refreshMenus stores state under the key WP returned', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-navunit-'));
  initState(theme, { url: 'http://x.local', path: '/x' });
  updateState(theme, (s) => { setPath(s, 'site.navigation.menus.a', { id: 1, spec: { items: [] }, pending: [{ label: 'A', page: 'a' }] }); });
  const wp = fakeWp([{ id: 1, key: 'a', created: false, pending: [] }]);
  refreshMenus(wp, theme);
  assert.deepEqual(Object.keys(loadState(theme).site.navigation.menus), ['a']);
});

test('CLI upsert without a spec file prints usage and exits 64', () => {
  const script = fileURLToPath(new URL('../../skills/protoblocks-site-builder/scripts/lib/navigation.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, 'upsert', os.tmpdir(), 'primary'], { encoding: 'utf8' });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /Usage/);
});
