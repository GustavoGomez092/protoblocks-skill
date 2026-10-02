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
