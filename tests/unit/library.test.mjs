import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarizeBlock, recordUse, readBlockJson, listLibrary } from '../../skills/protoblocks-site-builder/scripts/lib/library.mjs';
import { initState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills/protoblocks-site-builder/scripts/lib/library.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pb-lib-'));
const theme = () => { const t = tmp(); initState(t, { url: 'http://a.local', path: '/x' }); return t; };
const addBlock = (t, slug, json) => {
  const d = path.join(t, 'proto-blocks', slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'block.json'), typeof json === 'string' ? json : JSON.stringify(json));
};
const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code, `expected ${code}`);

test('summarizeBlock lists fields, controls with options, inner blocks', () => {
  const s = summarizeBlock({ name: 'proto-blocks/media-text', title: 'Media Text', protoBlocks: { useTailwind: true,
    fields: { heading: { type: 'text' }, body: { type: 'wysiwyg' }, slot: { type: 'inner-blocks' } },
    controls: { imagePosition: { type: 'select', options: [{ key: 'left' }, { key: 'right' }] }, dark: { type: 'toggle' } } } });
  assert.deepEqual(s.fields, { heading: 'text', body: 'wysiwyg', slot: 'inner-blocks' });
  assert.deepEqual(s.controls, { imagePosition: 'select(left|right)', dark: 'toggle' });
  assert.equal(s.innerBlocks, true);
  assert.equal(s.useTailwind, true);
});

test('summarizeBlock treats the validator spelling innerblocks as inner blocks', () => {
  const s = summarizeBlock({ name: 'proto-blocks/x', protoBlocks: { fields: { slot: { type: 'innerblocks' } } } });
  assert.equal(s.innerBlocks, true);
  assert.equal(summarizeBlock({ name: 'proto-blocks/x', protoBlocks: { fields: { h: { type: 'text' } } } }).innerBlocks, false);
});

test('recordUse adds a page once and stores purpose/variants', () => {
  const t = theme();
  recordUse(t, 'media-text', 'home', { purpose: 'image beside copy', variants: ['imagePosition'] });
  recordUse(t, 'media-text', 'home');
  recordUse(t, 'media-text', 'about');
  const e = loadState(t).library['media-text'];
  assert.deepEqual(e.usedOn, ['home', 'about']);
  assert.equal(e.purpose, 'image beside copy');
  assert.deepEqual(e.variants, ['imagePosition']);
});

test('recordUse rejects unsafe block slugs with EBLOCK and does not touch state', () => {
  const t = theme();
  for (const bad of ['__proto__', '../x', 'A b', '', '-x', 'constructor/x']) {
    throwsCode(() => recordUse(t, bad, 'home'), 'EBLOCK');
  }
  assert.deepEqual(loadState(t).library, {});
  assert.equal(Object.getPrototypeOf(loadState(t).library), Object.prototype);
  assert.equal(({}).usedOn, undefined);
});

test('recordUse rejects unsafe page slugs with ESLUG', () => {
  const t = theme();
  for (const bad of ['__proto__', '../x', 'Home Page', '', undefined]) {
    throwsCode(() => recordUse(t, 'media-text', bad), 'ESLUG');
  }
  assert.deepEqual(loadState(t).library, {});
});

test('recordUse rejects variants that are not a list of safe tokens', () => {
  const t = theme();
  for (const bad of ['imagePosition', [1], ['a b'], ['__proto__'], [''], [{}]]) {
    throwsCode(() => recordUse(t, 'media-text', 'home', { variants: bad }), 'EVARIANT');
  }
  assert.deepEqual(loadState(t).library, {});
  recordUse(t, 'media-text', 'home', { variants: ['imagePosition', 'dark_mode', 'a-b'] });
});

test('readBlockJson returns null for a missing block and parses a present one', () => {
  const t = tmp();
  assert.equal(readBlockJson(t, 'nope'), null);
  addBlock(t, 'hero', { name: 'proto-blocks/hero' });
  assert.equal(readBlockJson(t, 'hero').name, 'proto-blocks/hero');
});

test('readBlockJson throws EBLOCKJSON naming the file on invalid JSON', () => {
  const t = tmp();
  addBlock(t, 'broken', '{ nope');
  assert.throws(() => readBlockJson(t, 'broken'), (e) => e.code === 'EBLOCKJSON' && e.message.includes(path.join('broken', 'block.json')));
});

test('readBlockJson refuses paths that escape proto-blocks/ (traversal and symlink)', () => {
  const t = tmp();
  fs.mkdirSync(path.join(t, 'proto-blocks'));
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'block.json'), '{"name":"evil"}');
  addBlock(t, 'real', { name: 'proto-blocks/real' });
  fs.writeFileSync(path.join(t, 'block.json'), '{"name":"evil"}');
  throwsCode(() => readBlockJson(t, '..'), 'EBLOCK');
  throwsCode(() => readBlockJson(t, '../..'), 'EBLOCK');
  fs.symlinkSync(outside, path.join(t, 'proto-blocks', 'link'));
  throwsCode(() => readBlockJson(t, 'link'), 'EBLOCK');
  // a symlinked block.json file pointing outside
  fs.mkdirSync(path.join(t, 'proto-blocks', 'fl'));
  fs.symlinkSync(path.join(outside, 'block.json'), path.join(t, 'proto-blocks', 'fl', 'block.json'));
  throwsCode(() => readBlockJson(t, 'fl'), 'EBLOCK');
});

const fakeWp = (stdout) => ({ check: () => stdout });
const failingWp = { check: () => { const e = new Error('wp proto-blocks list failed (exit 1): not a registered wp command'); e.code = 'EWP'; throw e; } };

test('listLibrary merges registered theme blocks with state, sorted, ignoring non-theme blocks', () => {
  const t = theme();
  addBlock(t, 'zeta', { name: 'proto-blocks/zeta', title: 'Zeta', protoBlocks: { fields: { h: { type: 'text' } } } });
  addBlock(t, 'alpha', { name: 'proto-blocks/alpha', title: 'Alpha' });
  addBlock(t, 'unregistered', { name: 'proto-blocks/unregistered' });
  recordUse(t, 'alpha', 'home', { purpose: 'p', variants: ['v'] });
  const out = 'Notice: something\n' + JSON.stringify([{ name: 'proto-blocks/zeta' }, { name: 'proto-blocks/alpha' }, { name: 'proto-blocks/plugin-only' }]) + '\n';
  const lib = listLibrary(fakeWp(out), t);
  assert.deepEqual(lib.map((e) => e.slug), ['alpha', 'zeta']);
  assert.equal(lib[0].purpose, 'p');
  assert.deepEqual(lib[0].usedOn, ['home']);
  assert.deepEqual(lib[1].usedOn, []);
  assert.deepEqual(lib[1].fields, { h: 'text' });
});

test('listLibrary works without a state file', () => {
  const t = tmp();
  addBlock(t, 'alpha', { name: 'proto-blocks/alpha' });
  const lib = listLibrary(fakeWp('[{"name":"proto-blocks/alpha"}]'), t);
  assert.deepEqual(lib.map((e) => e.slug), ['alpha']);
});

test('listLibrary throws ENOPROTOBLOCKS when wp fails, rather than returning an empty list', () => {
  const t = tmp();
  assert.throws(() => listLibrary(failingWp, t), (e) => e.code === 'ENOPROTOBLOCKS' && /proto-blocks/i.test(e.message));
});

test('listLibrary throws ENOPROTOBLOCKS on unparseable output and tolerates empty output', () => {
  const t = tmp();
  throwsCode(() => listLibrary(fakeWp('Error: nope\n'), t), 'ENOPROTOBLOCKS');
  assert.deepEqual(listLibrary(fakeWp(''), t), []);
});

test('listLibrary skips registered blocks whose slug is unsafe', () => {
  const t = tmp();
  fs.mkdirSync(path.join(t, 'proto-blocks'));
  fs.writeFileSync(path.join(t, 'block.json'), '{"name":"evil"}');
  assert.deepEqual(listLibrary(fakeWp('[{"name":"proto-blocks/.."}]'), t), []);
});

const cli = (...args) => spawnSync(process.execPath, [LIB, ...args], { encoding: 'utf8' });

test('CLI record stores usage and prints the entry', () => {
  const t = theme();
  const r = cli('record', t, 'hero', 'home', '--purpose', 'top banner', '--variants', 'a,b');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).variants, ['a', 'b']);
  assert.equal(loadState(t).library.hero.purpose, 'top banner');
});

test('CLI exits 64 with usage for a valueless flag, unknown flag, or missing args', () => {
  const t = theme();
  for (const args of [['record', t, 'hero', 'home', '--purpose'], ['record', t, 'hero', 'home', '--bogus', 'x'], ['record', t, 'hero'], ['list'], ['nope'], []]) {
    const r = cli(...args);
    assert.equal(r.status, 64, `${args.join(' ')} -> ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /Usage/);
  }
  assert.deepEqual(loadState(t).library, {});
});

test('CLI prints errors as [CODE] message and exits 1', () => {
  const t = theme();
  const r = cli('record', t, '__proto__', 'home');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[EBLOCK\] /);
});
