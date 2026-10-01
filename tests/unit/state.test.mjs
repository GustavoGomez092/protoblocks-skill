import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  initState, loadState, saveState, restoreState, updateState, validate,
  getPath, setPath, appendPath, statePath, StateError, DEFAULT_QA,
} from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const CLI = fileURLToPath(new URL('../../skills/protoblocks-site-builder/scripts/lib/state.mjs', import.meta.url));
let theme;
const site = { url: 'http://acme.local', path: '/x/app/public', wp: { mode: 'local-wrapper', wrapper: '/x/wp' } };

beforeEach(() => { theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-')); });

test('initState writes a valid state with QA defaults and a gitignore', () => {
  const s = initState(theme, site);
  assert.deepEqual(s.site.qa, DEFAULT_QA);
  assert.deepEqual(s.pages, []);
  assert.deepEqual(validate(loadState(theme)), []);
  const gi = fs.readFileSync(path.join(theme, '.protoblocks/.gitignore'), 'utf8');
  assert.match(gi, /artifacts\//);
});

test('initState refuses to overwrite', () => {
  initState(theme, site);
  assert.throws(() => initState(theme, site), (e) => e instanceof StateError && e.code === 'EEXISTS');
});

test('validate reports enum and required errors with paths', () => {
  const s = initState(theme, site);
  s.pages.push({ slug: 'home', status: 'building', sections: [{ n: 1, anchor: 'pb-s1', status: 'finished' }] });
  delete s.site.url;
  const errors = validate(s);
  assert.ok(errors.some((e) => e.startsWith('$.site.url: required')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('$.pages[0].sections[0].status: must be one of')), errors.join('\n'));
});

test('saveState refuses invalid state and leaves file untouched', () => {
  initState(theme, site);
  const before = fs.readFileSync(statePath(theme), 'utf8');
  assert.throws(() => saveState(theme, { schemaVersion: 1 }), (e) => e.code === 'EINVALID');
  assert.equal(fs.readFileSync(statePath(theme), 'utf8'), before);
});

test('saveState keeps a .bak of the previous version', () => {
  initState(theme, site);
  updateState(theme, (s) => { s.site.url = 'http://changed.local'; });
  const bak = JSON.parse(fs.readFileSync(statePath(theme) + '.bak', 'utf8'));
  assert.equal(bak.site.url, 'http://acme.local');
  assert.equal(loadState(theme).site.url, 'http://changed.local');
});

test('corrupt state reports EPARSE with a restore hint and restore recovers', () => {
  initState(theme, site);
  updateState(theme, (s) => { s.site.url = 'http://v2.local'; });
  fs.writeFileSync(statePath(theme), '{"schemaVersion": 1, "site": {'); // simulated crash
  assert.throws(() => loadState(theme), (e) => e.code === 'EPARSE' && /restore/.test(e.message));
  const restored = restoreState(theme);
  assert.equal(restored.site.url, 'http://acme.local');
  assert.equal(loadState(theme).site.url, 'http://acme.local');
});

test('loadState on missing file throws ENOSTATE', () => {
  assert.throws(() => loadState(theme), (e) => e.code === 'ENOSTATE');
});

test('getPath/setPath/appendPath handle objects and arrays', () => {
  const o = { pages: [{ sections: [{ status: 'planned' }] }] };
  assert.equal(getPath(o, 'pages.0.sections.0.status'), 'planned');
  setPath(o, 'pages.0.sections.0.status', 'done');
  assert.equal(o.pages[0].sections[0].status, 'done');
  setPath(o, 'library.media-text.purpose', 'two-column');
  assert.equal(o.library['media-text'].purpose, 'two-column');
  appendPath(o, 'pages.0.sections.0.qa', { iteration: 1 });
  assert.deepEqual(o.pages[0].sections[0].qa, [{ iteration: 1 }]);
  assert.equal(getPath(o, 'nope.deeper'), undefined);
});

test('CLI init/set/append/get round-trip', () => {
  const siteFile = path.join(theme, 'site.json');
  fs.writeFileSync(siteFile, JSON.stringify(site));
  execFileSync(process.execPath, [CLI, 'init', theme, siteFile]);
  execFileSync(process.execPath, [CLI, 'append', theme, 'pages', JSON.stringify({ slug: 'home', status: 'planning', sections: [] })]);
  execFileSync(process.execPath, [CLI, 'set', theme, 'pages.0.status', '"building"']);
  const out = execFileSync(process.execPath, [CLI, 'get', theme, 'pages.0.status'], { encoding: 'utf8' });
  assert.equal(JSON.parse(out), 'building');
});

test('CLI set with an invalid value exits non-zero and explains why', () => {
  const siteFile = path.join(theme, 'site.json');
  fs.writeFileSync(siteFile, JSON.stringify(site));
  execFileSync(process.execPath, [CLI, 'init', theme, siteFile]);
  const r = spawnSync(process.execPath, [CLI, 'set', theme, 'site.wp.mode', '"docker"'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\$\.site\.wp\.mode: must be one of/);
});

test('CLI get on missing path prints JSON null, not undefined', () => {
  const siteFile = path.join(theme, 'site.json');
  fs.writeFileSync(siteFile, JSON.stringify(site));
  execFileSync(process.execPath, [CLI, 'init', theme, siteFile]);
  const out = execFileSync(process.execPath, [CLI, 'get', theme, 'nope.deeper'], { encoding: 'utf8' });
  assert.equal(out.trim(), 'null');
  assert.equal(JSON.parse(out), null);
});

test('saveState does not overwrite .bak if current file is corrupt', () => {
  const s = initState(theme, site);
  updateState(theme, (st) => { st.site.url = 'http://v2.local'; });
  const bakPath = statePath(theme) + '.bak';
  const bakBefore = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
  assert.equal(bakBefore.site.url, 'http://acme.local');
  fs.writeFileSync(statePath(theme), '{"corrupt": "json'); // corrupt the build.json
  const validState = { schemaVersion: 1, site: { ...site, qa: DEFAULT_QA }, library: {}, pages: [] };
  saveState(theme, validState);
  const bakAfter = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
  assert.equal(bakAfter.site.url, 'http://acme.local', 'backup should not change when current file is corrupt');
});

test('updateState times out when lock is held beyond timeout and rejects with ELOCKED', () => {
  initState(theme, site);
  const lockPath = path.join(path.dirname(statePath(theme)), 'build.json.lock');
  fs.writeFileSync(lockPath, '');
  assert.throws(
    () => updateState(theme, (s) => {}, { timeoutMs: 100 }),
    (e) => e instanceof StateError && e.code === 'ELOCKED'
  );
});

test('updateState succeeds when lock is stale (older than 30s)', () => {
  initState(theme, site);
  const lockPath = path.join(path.dirname(statePath(theme)), 'build.json.lock');
  fs.writeFileSync(lockPath, '');
  const staleTime = Date.now() - 60000; // 60 seconds in the past
  fs.utimesSync(lockPath, staleTime / 1000, staleTime / 1000);
  updateState(theme, (s) => { s.site.url = 'http://changed.local'; });
  assert.equal(loadState(theme).site.url, 'http://changed.local');
});

test('initState gitignore includes build.json.lock', () => {
  const s = initState(theme, site);
  const gi = fs.readFileSync(path.join(theme, '.protoblocks/.gitignore'), 'utf8');
  assert.match(gi, /build\.json\.bak/);
  assert.match(gi, /build\.json\.lock/);
});

test('CLI init without site file exits 64 with usage message', () => {
  const r = spawnSync(process.execPath, [CLI, 'init', theme], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Usage:/);
});

test('CLI set without path exits 64 with usage message', () => {
  const siteFile = path.join(theme, 'site.json');
  fs.writeFileSync(siteFile, JSON.stringify(site));
  execFileSync(process.execPath, [CLI, 'init', theme, siteFile]);
  const r = spawnSync(process.execPath, [CLI, 'set', theme], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Usage:/);
});

test('saveState does not overwrite .bak if current file is valid JSON but fails schema', () => {
  initState(theme, site);
  updateState(theme, (s) => { s.site.url = 'http://v2.local'; });
  const bakPath = statePath(theme) + '.bak';
  const bakBefore = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
  assert.equal(bakBefore.site.url, 'http://acme.local');
  fs.writeFileSync(statePath(theme), JSON.stringify({ schemaVersion: 1 })); // valid JSON, invalid schema
  const validState = { schemaVersion: 1, site: { ...site, qa: DEFAULT_QA }, library: {}, pages: [] };
  saveState(theme, validState);
  const bakAfter = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
  assert.equal(bakAfter.site.url, 'http://acme.local', 'backup should not change when current file fails schema validation');
});

test('updateState on empty dir throws ENOSTATE', () => {
  assert.throws(
    () => updateState(theme, (s) => {}),
    (e) => e instanceof StateError && e.code === 'ENOSTATE'
  );
});

function cliInit() {
  const siteFile = path.join(theme, 'site.json');
  fs.writeFileSync(siteFile, JSON.stringify(site));
  execFileSync(process.execPath, [CLI, 'init', theme, siteFile]);
}
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const page = JSON.stringify({ slug: 'p', status: 'planning', sections: [] });

test('CLI set pages.2 on an empty array is rejected and the file is unchanged', () => {
  cliInit();
  const before = fs.readFileSync(statePath(theme), 'utf8');
  const r = cli('set', theme, 'pages.2', page);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\[EINVALID\]/);
  assert.equal(fs.readFileSync(statePath(theme), 'utf8'), before);
});

test('setPath allows an index equal to length (append) but rejects past it', () => {
  const o = { pages: [] };
  setPath(o, 'pages.0', { a: 1 });
  assert.equal(o.pages.length, 1);
  assert.throws(() => setPath(o, 'pages.5', {}), (e) => e.code === 'EINVALID');
});

test('setPath rejects a non-index key on an array', () => {
  assert.throws(() => setPath({ pages: [] }, 'pages.home', 'x'), (e) => e.code === 'EINVALID' && /array/.test(e.message));
});

test('setPath and appendPath reject prototype-polluting segments', () => {
  assert.throws(() => setPath({}, '__proto__.x', 1), (e) => e.code === 'EINVALID');
  assert.throws(() => setPath({}, 'a.constructor.b', 1), (e) => e.code === 'EINVALID');
  assert.throws(() => appendPath({}, 'prototype.x', 1), (e) => e.code === 'EINVALID');
  assert.equal({}.x, undefined);
});

test('validate reports holes in arrays', () => {
  const s = initState(theme, site);
  s.pages.length = 2; // two holes
  assert.ok(validate(s).length > 0);
});

test('CLI set with non-JSON value exits 1 with EVALUE, not EPARSE', () => {
  cliInit();
  const r = cli('set', theme, 'site.url', 'not-json');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[EVALUE\] Value is not valid JSON/);
  assert.doesNotMatch(r.stderr, /EPARSE/);
});

test('CLI restore recovers the prior good write after corruption', () => {
  cliInit();
  assert.equal(cli('set', theme, 'site.url', '"http://v2.local"').status, 0);
  fs.writeFileSync(statePath(theme), '{"broken');
  const bad = cli('get', theme, 'site.url');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /\[EPARSE\]/);
  assert.equal(cli('restore', theme).status, 0);
  assert.equal(JSON.parse(cli('get', theme, 'site.url').stdout), 'http://acme.local');
});

test('CLI restore without a backup exits 1 with ENOBACKUP', () => {
  const r = cli('restore', theme);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[ENOBACKUP\]/);
});
