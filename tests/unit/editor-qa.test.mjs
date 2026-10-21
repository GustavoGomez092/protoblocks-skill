import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  QA_USER, QA_USER_EMAIL, declaredFields, compareFields, expectedAnchors, compareSections, editorPass, qaPreferences, ensureQaUser, deleteQaUser,
  pageInputs, partsInputs, recordEditorQa, recordPartsEditorQa, randomPassword,
} from '../../skills/protoblocks-site-builder/scripts/qa/editor-qa.mjs';
import { recordPageQa } from '../../skills/protoblocks-site-builder/scripts/qa/page-qa.mjs';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { nextAction } from '../../skills/protoblocks-site-builder/scripts/lib/status.mjs';

const SCRIPT = new URL('../../skills/protoblocks-site-builder/scripts/qa/editor-qa.mjs', import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pb-editorqa-unit-'));
const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code, code);

// A block.json like the ones the section loop writes: fields, a repeater with subfields and item controls, controls.
const JSON_ = {
  title: 'Feature Grid',
  protoBlocks: {
    fields: {
      heading: { type: 'text', tagName: 'h2' },
      intro: { type: 'rich-text' },
      cards: { type: 'repeater', fields: { title: { type: 'text' }, text: { type: 'text' }, cardLink: { type: 'link' } }, itemControls: { tone: { type: 'select', options: ['a'] } } },
      body: { type: 'inner-blocks' },
    },
    controls: { columns: { type: 'range', min: 2, max: 4 } },
  },
};

test('declaredFields lists fields and repeater subfields as <repeater>.<sub>, never itemControls', () => {
  assert.deepEqual(declaredFields(JSON_).map((d) => [d.name, d.type, d.repeater ?? null]), [
    ['heading', 'text', null], ['intro', 'rich-text', null], ['cards', 'repeater', null],
    ['cards.title', 'text', 'cards'], ['cards.text', 'text', 'cards'], ['cards.cardLink', 'link', 'cards'], ['body', 'inner-blocks', null],
  ]);
  assert.deepEqual(declaredFields({}), []);
  assert.deepEqual(declaredFields({ protoBlocks: { fields: { x: {} } } }).map((d) => d.type), ['text']);
});

const BOUND = { fields: { heading: 1, intro: 1, title: 2, text: 2, cardLink: 2 }, repeaters: { cards: { items: 2, fields: { title: 2, text: 2, cardLink: 2 }, linkItems: 0 } }, innerBlocks: 1 };

test('compareFields: every declared field bound in the preview markup', () => {
  const r = compareFields(JSON_, BOUND);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.bound, r.declared);
  assert.deepEqual([r.toolbar, r.hints], [[], []]);
});

test('compareFields: unbound top-level field, repeater container, inner blocks and subfield are reported by name', () => {
  const r = compareFields(JSON_, { fields: { heading: 1, title: 1 }, repeaters: { cards: { items: 1, fields: { title: 1 }, linkItems: 0 } }, innerBlocks: 0 });
  assert.deepEqual(r.missing, ['intro', 'cards.text', 'cards.cardLink', 'body']);
  assert.deepEqual(r.bound, ['heading', 'cards', 'cards.title']);
  const noRepeater = compareFields(JSON_, { fields: { heading: 1, intro: 1 }, repeaters: {}, innerBlocks: 1 });
  assert.deepEqual(noRepeater.missing, ['cards', 'cards.title', 'cards.text', 'cards.cardLink']);
  assert.deepEqual(noRepeater.hints, [], 'no hint when the container itself is missing');
});

test('compareFields: a repeater that renders no preview item leaves its subfields unbound, with the seeding hint', () => {
  const r = compareFields(JSON_, { fields: { heading: 1, intro: 1 }, repeaters: { cards: { items: 0, fields: {}, linkItems: 0 } }, innerBlocks: 1 });
  assert.deepEqual(r.missing, ['cards.title', 'cards.text', 'cards.cardLink']);
  assert.deepEqual(r.bound, ['heading', 'intro', 'cards', 'body']);
  assert.equal(r.hints.length, 1);
  assert.match(r.hints[0], /repeater "cards" renders no item[^\n]*seed a placeholder item under \$is_preview/);
});

test('compareFields: a link subfield counts as bound through the item toolbar when the item is or holds an <a> (whole-card link)', () => {
  const r = compareFields(JSON_, { ...BOUND, fields: { heading: 1, intro: 1, title: 2, text: 2 }, repeaters: { cards: { items: 2, fields: { title: 2, text: 2 }, linkItems: 2 } } });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.toolbar, ['cards.cardLink']);
  // A text subfield never counts through the toolbar.
  const t = compareFields(JSON_, { ...BOUND, repeaters: { cards: { items: 2, fields: { title: 2, cardLink: 2 }, linkItems: 2 } } });
  assert.deepEqual(t.missing, ['cards.text']);
  assert.deepEqual(t.toolbar, []);
});

test('compareFields: inner-blocks (both spellings) and null bindings (preview failed: everything missing)', () => {
  const j = { protoBlocks: { fields: { a: { type: 'innerblocks' } } } };
  assert.deepEqual(compareFields(j, { fields: {}, repeaters: {}, innerBlocks: 1 }).missing, []);
  assert.deepEqual(compareFields(j, { fields: {}, repeaters: {}, innerBlocks: 0 }).missing, ['a']);
  assert.deepEqual(compareFields(JSON_, null).missing, compareFields(JSON_, null).declared);
});

test('expectedAnchors: sections not in a part and not skipped, in n order', () => {
  const sections = [{ n: 3, anchor: 'pb-footer', status: 'done', inPart: true }, { n: 2, anchor: 'pb-s2', status: 'done' }, { n: 4, anchor: 'pb-s4', status: 'skipped' }, { n: 1, anchor: 'pb-header', status: 'done', inPart: false }, { n: 5, anchor: 'pb-s5', status: 'verifying' }];
  assert.deepEqual(expectedAnchors(sections), ['pb-header', 'pb-s2', 'pb-s5']);
  assert.deepEqual(expectedAnchors(), []);
});

test('compareSections: present once and in order with nothing extra passes; missing, extra, duplicate and reordered fail', () => {
  const ok = compareSections(['pb-header', 'pb-s2'], [{ name: 'proto-blocks/site-header', anchor: 'pb-header' }, { name: 'proto-blocks/hero', anchor: 'pb-s2' }]);
  assert.deepEqual([ok.pass, ok.order, ok.missing, ok.extra, ok.duplicates, ok.found], [true, true, [], [], [], ['pb-header', 'pb-s2']]);
  const missing = compareSections(['pb-header', 'pb-s2'], [{ name: 'proto-blocks/site-header', anchor: 'pb-header' }]);
  assert.deepEqual([missing.pass, missing.missing], [false, ['pb-s2']]);
  const extra = compareSections(['pb-s2'], [{ name: 'core/paragraph', anchor: null }, { name: 'proto-blocks/hero', anchor: 'pb-s2' }, { name: 'proto-blocks/hero', anchor: 'pb-s9' }]);
  assert.deepEqual([extra.pass, extra.order, extra.extra], [false, true, [{ name: 'core/paragraph', anchor: null }, { name: 'proto-blocks/hero', anchor: 'pb-s9' }]]);
  const dup = compareSections(['pb-s2'], [{ name: 'proto-blocks/hero', anchor: 'pb-s2' }, { name: 'proto-blocks/hero', anchor: 'pb-s2' }]);
  assert.deepEqual([dup.pass, dup.duplicates, dup.order], [false, ['pb-s2'], false]);
  const order = compareSections(['pb-s2', 'pb-s3'], [{ name: 'b', anchor: 'pb-s3' }, { name: 'a', anchor: 'pb-s2' }]);
  assert.deepEqual([order.pass, order.order, order.missing], [false, false, []]);
});

const okBlock = (extra = {}) => ({ anchor: 'pb-s2', name: 'proto-blocks/hero', proto: true, isValid: true, rendered: true, fields: { declared: ['a'], bound: ['a'], missing: [] }, inspector: { pass: true }, ...extra });
const okResult = (extra = {}) => ({ loaded: true, pageErrors: [], sections: { pass: true }, dirty: false, blocks: [okBlock()], ...extra });

test('editorPass: every condition must hold; a non-proto block only needs to be valid', () => {
  assert.equal(editorPass(okResult()), true);
  assert.equal(editorPass(okResult({ blocks: [okBlock(), { name: 'core/paragraph', proto: false, isValid: true }] })), true);
  const failing = {
    notLoaded: { loaded: false }, pageErrors: { pageErrors: ['boom'] }, sections: { sections: { pass: false } }, dirty: { dirty: true }, dirtyUnknown: { dirty: null },
    invalid: { blocks: [okBlock({ isValid: false })] }, notRendered: { blocks: [okBlock({ rendered: false })] }, unbound: { blocks: [okBlock({ fields: { declared: ['a'], bound: [], missing: ['a'] } })] },
    inspector: { blocks: [okBlock({ inspector: { pass: false } })] }, coreInvalid: { blocks: [okBlock(), { name: 'core/paragraph', proto: false, isValid: false }] }, noBlocks: { blocks: null },
  };
  for (const [name, extra] of Object.entries(failing)) assert.equal(editorPass(okResult(extra)), false, name);
  assert.equal(editorPass(null), false);
});

test('qaPreferences turns the welcome guides off in the post editor and the Site Editor', () => {
  const p = qaPreferences('2026-10-20T00:00:00.000Z');
  assert.deepEqual(p['core/edit-post'], { welcomeGuide: false, welcomeGuideTemplate: false });
  assert.equal(p['core/edit-site'].welcomeGuide, false);
  assert.equal(p._modified, '2026-10-20T00:00:00.000Z');
  assert.match(qaPreferences()._modified, /^\d{4}-\d\d-\d\dT/);
});

// A fake WP-CLI: records argv, answers from a script keyed by the subcommand.
function fakeWp(answers) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args);
    const key = args.slice(0, 3).join(' ');
    const a = Object.entries(answers).find(([k]) => key.startsWith(k));
    return a ? a[1](args) : { code: 1, stdout: '', stderr: `no answer for ${key}` };
  };
  return { wp: createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }), calls };
}

test('ensureQaUser reuses an existing pb-editor-qa, resets its password and writes the preferences meta', () => {
  const { wp, calls } = fakeWp({ 'user get': () => ({ code: 0, stdout: '12\n', stderr: '' }), 'user update': () => ({ code: 0, stdout: 'Success: Updated user 12.\n', stderr: '' }), 'user meta': () => ({ code: 0, stdout: 'Success\n', stderr: '' }) });
  const r = ensureQaUser(wp, { password: 'S3cret-pw', now: '2026-10-20T00:00:00.000Z' });
  assert.deepEqual(r, { id: 12, created: false, password: 'S3cret-pw' });
  assert.deepEqual(calls[0], ['user', 'get', QA_USER, '--field=ID']);
  assert.deepEqual(calls[1], ['user', 'update', '12', '--user_pass=S3cret-pw', '--role=administrator', '--skip-email']);
  assert.deepEqual(calls[2].slice(0, 5), ['user', 'meta', 'update', '12', 'wp_persisted_preferences']);
  assert.deepEqual(JSON.parse(calls[2][5]), qaPreferences('2026-10-20T00:00:00.000Z'));
  assert.equal(calls[2][6], '--format=json');
  assert.equal(calls.length, 3, 'no create for an existing user');
});

test('ensureQaUser creates the administrator (porcelain id) when it does not exist; a random password per run', () => {
  const { wp, calls } = fakeWp({ 'user get': () => ({ code: 1, stdout: '', stderr: 'Error: Invalid user ID, email or login: pb-editor-qa' }), 'user create': () => ({ code: 0, stdout: '34\n', stderr: '' }), 'user update': () => ({ code: 0, stdout: '', stderr: '' }), 'user meta': () => ({ code: 0, stdout: '', stderr: '' }) });
  const r = ensureQaUser(wp);
  assert.deepEqual([r.id, r.created], [34, true]);
  assert.ok(r.password.length >= 24);
  assert.deepEqual(calls[1].slice(0, 4), ['user', 'create', QA_USER, QA_USER_EMAIL]);
  assert.ok(calls[1].includes('--role=administrator') && calls[1].includes(`--user_pass=${r.password}`) && calls[1].includes('--porcelain'));
  assert.notEqual(randomPassword(), randomPassword());
});

test('ensureQaUser never leaks the password through a WP-CLI failure (message, args and output are redacted)', () => {
  const { wp } = fakeWp({ 'user get': () => ({ code: 0, stdout: '12\n', stderr: '' }), 'user update': (args) => ({ code: 1, stdout: '', stderr: `Error: bad ${args.join(' ')}` }) });
  assert.throws(() => ensureQaUser(wp, { password: 'Leaky-pw' }), (e) => {
    assert.equal(e.code, 'EWP');
    assert.ok(!e.message.includes('Leaky-pw'), e.message);
    assert.ok(!e.args.join(' ').includes('Leaky-pw'));
    assert.ok(!e.result.stderr.includes('Leaky-pw'));
    return true;
  });
  const bad = fakeWp({ 'user get': () => ({ code: 1, stdout: '', stderr: '' }), 'user create': () => ({ code: 0, stdout: 'Success: Created user.\n', stderr: '' }) });
  throwsCode(() => ensureQaUser(bad.wp), 'EUSER');
  const del = fakeWp({ 'user delete': () => ({ code: 0, stdout: 'Success: Removed user 12 from http://a.local.\n', stderr: '' }) });
  assert.equal(deleteQaUser(del.wp).code, 0);
  assert.deepEqual(del.calls[0], ['user', 'delete', QA_USER, '--yes']);
});

function stateWith(pages, site = { url: 'http://a.local/', path: '/x', theme: { slug: 'acme' } }) {
  const dir = tmp();
  initState(dir, site);
  updateState(dir, (s) => { s.pages = pages; });
  return dir;
}
const SECTIONS = [{ n: 1, anchor: 'pb-header', status: 'done', inPart: true }, { n: 2, anchor: 'pb-s2', status: 'done' }, { n: 3, anchor: 'pb-s3', status: 'skipped' }, { n: 4, anchor: 'pb-s4', status: 'done' }];
const page = (extra = {}) => ({ slug: 'home', url: 'http://a.local/home/', postId: 42, status: 'building', sections: SECTIONS, ...extra });

test('pageInputs: the post editor url from postId, the expected anchors, the artifacts dir; no page / no postId is ENOPAGE', () => {
  const dir = stateWith([page()]);
  const i = pageInputs(dir, 'home');
  assert.equal(i.url, 'http://a.local/wp-admin/post.php?post=42&action=edit');
  assert.deepEqual([i.kind, i.slug, i.postId, i.siteUrl, i.expected], ['page', 'home', 42, 'http://a.local', ['pb-s2', 'pb-s4']]);
  assert.equal(i.outDir, path.join(dir, '.protoblocks', 'artifacts', 'home', 'editor-qa'));
  throwsCode(() => pageInputs(dir, 'nope'), 'ENOPAGE');
  throwsCode(() => pageInputs(stateWith([page({ postId: null })]), 'home'), 'ENOPAGE');
  throwsCode(() => pageInputs(stateWith([page({ sections: [{ n: 1, anchor: 'bad anchor', status: 'done' }] })]), 'home'), 'EINPUT');
});

test('partsInputs: a Site Editor url per written part (theme slug from state), each with its fixed anchor; none is ENOPAGE', () => {
  const dir = stateWith([], { url: 'https://acme.local', path: '/x', theme: { slug: 'acme' }, parts: { header: { block: 'site-header', writtenAt: 'x' }, footer: { writtenAt: 'x' } } });
  const i = partsInputs(dir);
  assert.equal(i.kind, 'parts');
  assert.deepEqual(i.parts.map((p) => [p.part, p.expected]), [['header', ['pb-header']], ['footer', ['pb-footer']]]);
  assert.equal(i.parts[0].url, 'https://acme.local/wp-admin/site-editor.php?postType=wp_template_part&postId=acme%2F%2Fheader&canvas=edit');
  assert.equal(i.outDir, path.join(dir, '.protoblocks', 'artifacts', 'parts', 'editor-qa'));
  const headerOnly = stateWith([], { url: 'https://acme.local', path: '/x', parts: { header: { writtenAt: 'x' } } });
  assert.deepEqual(partsInputs(headerOnly).parts.map((p) => p.part), ['header']);
  assert.match(partsInputs(headerOnly).parts[0].url, new RegExp(`postId=${encodeURIComponent(path.basename(headerOnly))}%2F%2Fheader`), 'falls back to the folder name as theme slug');
  throwsCode(() => partsInputs(stateWith([])), 'ENOPAGE');
});

const writeResult = (dir, obj) => { const f = path.join(dir, `eq-${Math.random().toString(16).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

test('recordEditorQa writes editorQa {pass, file, at}; a pass reaches seo only once page QA passed or was accepted', async () => {
  const dir = stateWith([page()]);
  assert.deepEqual(recordEditorQa(dir, 'home', writeResult(dir, { postId: 42, pass: false })), { pass: false, status: 'building' });
  let p = loadState(dir).pages[0];
  assert.deepEqual([p.editorQa.pass, p.status, typeof p.editorQa.at], [false, 'building', 'string']);
  const f = writeResult(dir, { postId: 42, pass: true });
  assert.deepEqual(recordEditorQa(dir, 'home', path.relative(process.cwd(), f)), { pass: true, status: 'building' }, 'editor QA alone does not finish the page');
  p = loadState(dir).pages[0];
  assert.deepEqual([p.editorQa.pass, p.editorQa.file, p.status], [true, f, 'building']);
  assert.deepEqual(nextAction({ schemaVersion: 1, site: { url: 'http://a.local', path: '/x', theme: { slug: 'a', screenshot: { page: 'home' } }, tokens: {}, navigation: { menus: { primary: { id: 1 } } }, parts: { header: {} } }, library: {}, pages: [p] }).action, 'page-qa');
  // Page QA passing afterwards completes the pair: page-qa.mjs record moves the page to seo.
  assert.deepEqual(await recordPageQa(dir, 'home', writeResult(dir, { url: 'http://a.local/home/', pass: true })), { pass: true, status: 'seo' });
  // The other order: page QA accepted first, then editor QA passes.
  const d2 = stateWith([page({ pageQa: { pass: false, accepted: true, note: 'n', by: 'developer', file: '/f', at: 'x' } })]);
  assert.deepEqual(recordEditorQa(d2, 'home', writeResult(d2, { postId: 42, pass: true })), { pass: true, status: 'seo' });
  assert.equal(loadState(d2).pages[0].status, 'seo');
  const d3 = stateWith([page({ pageQa: { pass: true, file: '/f', at: 'x' } })]);
  assert.deepEqual(recordEditorQa(d3, 'home', writeResult(d3, { postId: 42, pass: false })), { pass: false, status: 'building' });
});

test('recordEditorQa guards: page must be building with every section closed, the result of the same post; bad file is EINPUT', () => {
  for (const st of ['planning', 'seo', 'done']) throwsCode(() => recordEditorQa(stateWith([page({ status: st })]), 'home', writeResult(tmp(), { postId: 42, pass: true })), 'ESTATUS');
  for (const st of ['planned', 'building', 'verifying', 'animating']) {
    const dir = stateWith([page({ sections: [{ n: 1, anchor: 'pb-s1', status: 'done' }, { n: 2, anchor: 'pb-s2', status: st }] })]);
    assert.throws(() => recordEditorQa(dir, 'home', writeResult(dir, { postId: 42, pass: true })), (e) => e.code === 'ESTATUS' && /2: /.test(e.message), st);
  }
  const dir = stateWith([page()]);
  throwsCode(() => recordEditorQa(dir, 'nope', writeResult(dir, { postId: 42, pass: true })), 'ENOPAGE');
  throwsCode(() => recordEditorQa(dir, 'home', writeResult(dir, { postId: 43, pass: true })), 'EINPUT');
  throwsCode(() => recordEditorQa(dir, 'home', writeResult(dir, { pass: true })), 'EINPUT');
  throwsCode(() => recordEditorQa(dir, 'home', path.join(dir, 'absent.json')), 'EINPUT');
  const f = path.join(dir, 'bad.json');
  fs.writeFileSync(f, '{not json');
  throwsCode(() => recordEditorQa(dir, 'home', f), 'EINPUT');
  fs.writeFileSync(f, '[]');
  throwsCode(() => recordEditorQa(dir, 'home', f), 'EINPUT');
  assert.deepEqual([loadState(dir).pages[0].status, loadState(dir).pages[0].editorQa], ['building', undefined]);
});

test('recordPartsEditorQa writes site.parts.editorQa and keeps the parts; a page result is refused', () => {
  const dir = stateWith([], { url: 'http://a.local', path: '/x', parts: { header: { block: 'site-header', writtenAt: 'x' } } });
  const f = writeResult(dir, { pass: false, parts: { header: { pass: true }, footer: { pass: false } } });
  assert.deepEqual(recordPartsEditorQa(dir, f), { pass: false, parts: { header: true, footer: false } });
  const parts = loadState(dir).site.parts;
  assert.deepEqual(parts.header, { block: 'site-header', writtenAt: 'x' });
  assert.deepEqual([parts.editorQa.pass, parts.editorQa.file, typeof parts.editorQa.at], [false, f, 'string']);
  assert.deepEqual(recordPartsEditorQa(dir, writeResult(dir, { pass: true, parts: { header: { pass: true } } })), { pass: true, parts: { header: true } });
  assert.equal(loadState(dir).site.parts.editorQa.pass, true);
  throwsCode(() => recordPartsEditorQa(dir, writeResult(dir, { postId: 42, pass: true })), 'EINPUT');
});

test('editor-qa CLI: strict usage (64), record by page and --parts, error codes on stderr', () => {
  const dir = stateWith([page()], { url: 'http://a.local', path: '/x', parts: { header: { writtenAt: 'x' } } });
  const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
  for (const args of [[], ['run'], ['run', dir], ['run', dir, 'home', 'extra'], ['run', dir, '--force'], ['record', dir, 'home'], ['record', dir, 'home', 'f', 'extra'], ['record', dir, '--parts'], ['record', dir, 'home', '--parts'], ['frobnicate', dir]]) {
    const r = run(...args);
    assert.equal(r.status, 64, JSON.stringify(args));
    assert.match(r.stderr, /^Usage: node editor-qa\.mjs run <themeDir> <page> \| run <themeDir> --parts \| record/);
  }
  let r = run('record', dir, 'home', writeResult(dir, { postId: 42, pass: true }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { pass: true, status: 'building' });
  r = run('record', dir, '--parts', writeResult(dir, { pass: true, parts: { header: { pass: true } } }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { pass: true, parts: { header: true } });
  r = run('record', dir, 'nope', writeResult(dir, { postId: 42, pass: true }));
  assert.deepEqual([r.status, /^\[ENOPAGE\]/.test(r.stderr)], [1, true]);
  // run needs preflight's runtime before it touches a browser or WP-CLI.
  r = run('run', dir, 'home');
  assert.deepEqual([r.status, /^\[ENORUNTIME\]/.test(r.stderr)], [1, true], r.stderr);
});
