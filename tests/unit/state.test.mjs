import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  initState, loadState, saveState, restoreState, updateState, validate,
  getPath, setPath, appendPath, statePath, StateError, DEFAULT_QA,
} from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const CLI = new URL('../../skills/protoblocks-site-builder/scripts/lib/state.mjs', import.meta.url).pathname;
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
