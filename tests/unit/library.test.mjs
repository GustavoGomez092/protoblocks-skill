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

// ---- fix round 1 ----
const listOf = (...slugs) => fakeWp(JSON.stringify(slugs.map((s) => ({ name: `proto-blocks/${s}` }))));
const captureStderr = (fn) => {
  const orig = process.stderr.write;
  let buf = '';
  process.stderr.write = (c) => { buf += c; return true; };
  try { return { result: fn(), stderr: buf }; } finally { process.stderr.write = orig; }
};

test('listLibrary keeps a broken block visible with an error entry and warns on stderr', () => {
  const t = tmp();
  addBlock(t, 'good', { name: 'proto-blocks/good', title: 'Good' });
  addBlock(t, 'broken', '{ nope');
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'block.json'), '{"name":"evil"}');
  fs.symlinkSync(outside, path.join(t, 'proto-blocks', 'escape'));
  const { result: lib, stderr } = captureStderr(() => listLibrary(listOf('good', 'broken', 'escape'), t));
  assert.deepEqual(lib.map((e) => e.slug), ['broken', 'escape', 'good']);
  assert.equal(lib[0].error.code, 'EBLOCKJSON');
  assert.match(lib[0].error.message, /broken/);
  assert.equal(lib[1].error.code, 'EBLOCK');
  assert.equal(lib[2].error, undefined);
  assert.equal(lib[2].title, 'Good');
  assert.match(stderr, /broken/);
  assert.equal(stderr.trim().split('\n').length, 2);
});

test('summarizeBlock is null-safe and handles string options and optionsSource', () => {
  const s = summarizeBlock({ name: 'x', protoBlocks: {
    fields: { a: null, b: { type: 'text' } },
    controls: { c: null, size: { type: 'select', options: ['s', 'm', null, { value: 'l' }] },
      page: { type: 'select', optionsSource: 'wp:posts', sourceArgs: { post_type: 'page' } },
      cat: { type: 'radio', optionsSource: 'wp:terms' }, plain: { type: 'select' } } } });
  assert.deepEqual(s.fields, { a: undefined, b: 'text' });
  assert.equal(s.controls.size, 'select(s|m|l)');
  assert.equal(s.controls.page, 'select(@wp:posts)');
  assert.equal(s.controls.cat, 'radio(@wp:terms)');
  assert.equal(s.controls.plain, 'select');
  assert.equal(s.controls.c, undefined);
  assert.doesNotThrow(() => summarizeBlock({ name: 'x', protoBlocks: null }));
});

test('summarizeBlock renders repeaters from nested fields and sees inner blocks inside them', () => {
  const s = summarizeBlock({ name: 'x', protoBlocks: { fields: {
    items: { type: 'repeater', fields: { title: { type: 'text' }, content: { type: 'wysiwyg' } } },
    rows: { type: 'repeater', fields: { body: { type: 'innerblocks' } } },
    empty: { type: 'repeater' } } } });
  assert.equal(s.fields.items, 'repeater(title:text,content:wysiwyg)');
  assert.equal(s.fields.rows, 'repeater(body:innerblocks)');
  assert.equal(s.fields.empty, 'repeater()');
  assert.equal(s.innerBlocks, true);
  assert.equal(summarizeBlock({ name: 'x', protoBlocks: { fields: { items: { type: 'repeater', fields: { t: { type: 'text' } } } } } }).innerBlocks, false);
});

test('summarizeBlock summarises the real example blocks', () => {
  const ex = '/Volumes/Content/projects/proto-blocks/proto-blocks/examples';
  if (!fs.existsSync(ex)) return;
  const hero = summarizeBlock(JSON.parse(fs.readFileSync(path.join(ex, 'hero', 'block.json'), 'utf8')));
  assert.equal(hero.innerBlocks, true);
  const acc = summarizeBlock(JSON.parse(fs.readFileSync(path.join(ex, 'accordion', 'block.json'), 'utf8')));
  assert.match(acc.fields.items, /^repeater\(title:text,content:wysiwyg/);
  const dyn = summarizeBlock(JSON.parse(fs.readFileSync(path.join(ex, 'dynamic-select', 'block.json'), 'utf8')));
  assert.equal(dyn.controls.relatedPage, 'select(@wp:posts)');
});

test('readBlockJson falls back to <name>.json, with the same containment', () => {
  const t = tmp();
  const d = path.join(t, 'proto-blocks', 'legacy');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'legacy.json'), '{"name":"proto-blocks/legacy"}');
  assert.equal(readBlockJson(t, 'legacy').name, 'proto-blocks/legacy');
  // block.json wins when both exist
  fs.writeFileSync(path.join(d, 'block.json'), '{"name":"proto-blocks/primary"}');
  assert.equal(readBlockJson(t, 'legacy').name, 'proto-blocks/primary');
  // invalid fallback JSON names the fallback file
  const d2 = path.join(t, 'proto-blocks', 'bad');
  fs.mkdirSync(d2);
  fs.writeFileSync(path.join(d2, 'bad.json'), '{ x');
  assert.throws(() => readBlockJson(t, 'bad'), (e) => e.code === 'EBLOCKJSON' && e.message.includes('bad.json'));
  // symlinked fallback escaping the root
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'o.json'), '{"name":"evil"}');
  const d3 = path.join(t, 'proto-blocks', 'esc');
  fs.mkdirSync(d3);
  fs.symlinkSync(path.join(outside, 'o.json'), path.join(d3, 'esc.json'));
  throwsCode(() => readBlockJson(t, 'esc'), 'EBLOCK');
  assert.equal(readBlockJson(t, 'none'), null);
});

test('listLibrary lists a block that only has <name>.json', () => {
  const t = tmp();
  const d = path.join(t, 'proto-blocks', 'legacy');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'legacy.json'), '{"name":"proto-blocks/legacy","title":"L"}');
  assert.equal(listLibrary(listOf('legacy'), t)[0].title, 'L');
});
