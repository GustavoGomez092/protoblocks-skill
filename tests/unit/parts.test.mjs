import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partMarkup, writePart, removeOverride, listOverrides } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

test('partMarkup wraps core/navigation inside the proto-block', () => {
  assert.equal(
    partMarkup({ block: 'proto-blocks/site-header', attrs: { sticky: true }, navRef: 12 }),
    '<!-- wp:proto-blocks/site-header {"sticky":true} -->\n<!-- wp:navigation {"ref":12} /-->\n<!-- /wp:proto-blocks/site-header -->\n',
  );
  assert.equal(partMarkup({ block: 'proto-blocks/site-footer' }), '<!-- wp:proto-blocks/site-footer /-->\n');
});

test('partMarkup requires navRef to be a positive integer when given', () => {
  for (const bad of ['12', 0, -3, 1.5, null, NaN]) {
    assert.throws(() => partMarkup({ block: 'proto-blocks/site-footer', navRef: bad }), /navRef/, String(bad));
  }
});

test('writePart writes parts/<slug>.html and rejects bad slugs', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-parts-'));
  const p = writePart(theme, 'header', 'X');
  assert.equal(fs.readFileSync(p, 'utf8'), 'X');
  assert.equal(p, path.join(theme, 'parts/header.html'));
  assert.throws(() => writePart(theme, '../evil', 'X'), /Invalid part slug/);
  assert.throws(() => writePart(theme, 'a/b', 'X'), /Invalid part slug/);
  assert.throws(() => writePart(theme, 'Header', 'X'), /Invalid part slug/);
  for (const bad of ['a--b', '-a', 'a-', '']) assert.throws(() => writePart(theme, bad, 'X'), /Invalid part slug/, bad);
  assert.deepEqual(fs.readdirSync(path.join(theme, 'parts')), ['header.html']);
});

const ROW = { id: 5, slug: 'header', theme: 'pb-itest', modified: '2025-01-01 00:00:00' };
const fakeWp = (rows = [ROW]) => {
  const calls = [];
  return { calls, evalFile: (file, args) => { calls.push(args); return args[0] === 'remove-override' ? { removed: rows.map((r) => r.id), records: rows } : rows; } };
};

test('removeOverride refuses without confirm and previews the exact rows', () => {
  const wp = fakeWp();
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', {}), (e) => e.code === 'ECONFIRM' && /Site Editor/.test(e.message) && e.message.includes('"id":5') && JSON.stringify(e.rows) === JSON.stringify([ROW]));
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header'), (e) => e.code === 'ECONFIRM');
  assert.ok(wp.calls.length > 0 && wp.calls.every((a) => a[0] === 'preview'), 'only preview calls');
});

test('removeOverride requires confirm === true exactly', () => {
  for (const c of ['true', 1, 'yes', {}]) {
    const wp = fakeWp();
    assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: c, expectId: 5 }), (e) => e.code === 'ECONFIRM');
    assert.ok(wp.calls.every((a) => a[0] === 'preview'));
  }
});

test('removeOverride with confirm passes theme, slug and an explicit confirm arg, returns records', () => {
  const wp = fakeWp();
  const r = removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 5 });
  assert.deepEqual(wp.calls.at(-1), ['remove-override', 'pb-itest', 'header', 'confirm', '5']);
  assert.deepEqual(r, { removed: [5], records: [ROW], recovery: ["wp eval 'wp_untrash_post(5);' && wp post update 5 --post_status=publish"] });
});

test('removeOverride rejects invalid slugs before any WP call', () => {
  for (const slug of ['Header', '../header', '--confirm', ' header', 'a/b', '', 'a--b', '-a', 'a-']) {
    const wp = { evalFile: () => { throw new Error('must not be called'); } };
    assert.throws(() => removeOverride(wp, 'pb-itest', slug, { confirm: true, expectId: 5 }), (e) => e.code === 'ESLUG', JSON.stringify(slug));
  }
});

test('removeOverride/listOverrides reject invalid theme slugs before any WP call', () => {
  for (const theme of ['', '../x', '.hidden', 'a b', undefined]) {
    const wp = { evalFile: () => { throw new Error('must not be called'); } };
    assert.throws(() => removeOverride(wp, theme, 'header', { confirm: true }), (e) => e.code === 'ETHEME');
    assert.throws(() => listOverrides(wp, theme), (e) => e.code === 'ETHEME');
  }
});

test('listOverrides passes the theme to parts.php', () => {
  const wp = fakeWp();
  assert.deepEqual(listOverrides(wp, 'pb-itest'), [ROW]);
  assert.deepEqual(wp.calls[0], ['overrides', 'pb-itest']);
});

test('removeOverride refuses more than one match (EAMBIGUOUS) and never removes', () => {
  const wp = fakeWp([ROW, { ...ROW, id: 6 }]);
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'EAMBIGUOUS' && /5/.test(e.message) && /6/.test(e.message));
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('removeOverride refuses rows that belong to another theme', () => {
  const wp = fakeWp([{ ...ROW, theme: 'twentytwentyfive' }]);
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'ETHEMEMISMATCH');
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('ECONFIRM text carries ids, the --id flag and the untrash recovery command', () => {
  const wp = fakeWp();
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', {}), (e) => e.code === 'ECONFIRM' && /--confirm --id 5/.test(e.message) && /wp_untrash_post\(5\);' && wp post update 5 --post_status=publish/.test(e.message));
});

test('confirm without expectId is refused (preview only)', () => {
  const wp = fakeWp();
  for (const id of [undefined, 0, -1, '5', 1.5, NaN]) {
    assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: id }), (e) => e.code === 'ECONFIRM', String(id));
  }
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('expectId that differs from the previewed row is ESTALE and removes nothing', () => {
  const wp = fakeWp();
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 6 }), (e) => e.code === 'ESTALE' && /wp-admin|preview/i.test(e.message));
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('no matching override: nothing to confirm or remove', () => {
  const wp = fakeWp([]);
  assert.deepEqual(removeOverride(wp, 'pb-itest', 'header', { confirm: true, expectId: 5 }), { removed: [], records: [], recovery: [] });
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

// --- real createWp with a fake exec: PHP failure codes and row themes ---
const rt = { wp: 'wp', mode: 'native', publicPath: '/x' };
const execReturning = (results) => { const calls = []; return { calls, exec: (cmd, args) => { calls.push(args); return results.shift(); } }; };
const ok = (v) => ({ code: 0, stdout: `${JSON.stringify(v)}\n`, stderr: '' });

test('PHP [CODE] and CODE: stderr tokens surface as e.code', () => {
  for (const [stderr, code] of [
    ['[EAMBIGUOUS] More than one match: IDs 1, 2\n', 'EAMBIGUOUS'],
    ['[ETHEMEMISMATCH] nope\n', 'ETHEMEMISMATCH'],
    ['[ESLUG] bad\n', 'ESLUG'],
    ['[ENOTRASH] Trash is disabled\n', 'ENOTRASH'],
    ['ESTALE: changed\n', 'ESTALE'],
    ['Warning: x\n[ESTALE] changed\n', 'ESTALE'],
  ]) {
    const { exec } = execReturning([{ code: 1, stdout: '', stderr }]);
    const wp = createWp(rt, { exec });
    assert.throws(() => listOverrides(wp, 'pb-itest'), (e) => e.code === code && !/^\[/.test(e.message) && e.message.length > 0, stderr);
  }
});

test('other failures keep the EWP code', () => {
  const { exec } = execReturning([{ code: 1, stdout: '', stderr: 'PHP Fatal error: boom' }]);
  assert.throws(() => listOverrides(createWp(rt, { exec }), 'pb-itest'), (e) => e.code === 'EWP');
});

test('a PHP code from the remove step surfaces too (ENOTRASH)', () => {
  const { exec, calls } = execReturning([ok([ROW]), { code: 1, stdout: '', stderr: '[ENOTRASH] Trash is disabled; use Site Editor -> Clear customizations\n' }]);
  assert.throws(() => removeOverride(createWp(rt, { exec }), 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'ENOTRASH' && /Clear customizations/.test(e.message));
  assert.equal(calls.length, 2);
});

test('JS refuses a row whose theme (from real terms) differs, via real createWp', () => {
  const { exec, calls } = execReturning([ok([{ ...ROW, theme: 'twentytwentyfive' }])]);
  assert.throws(() => removeOverride(createWp(rt, { exec }), 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'ETHEMEMISMATCH');
  assert.equal(calls.length, 1, 'only the preview ran');
  const two = execReturning([ok([{ ...ROW, theme: 'pb-itest,twentytwentyfive' }])]);
  assert.throws(() => removeOverride(createWp(rt, { exec: two.exec }), 'pb-itest', 'header', { confirm: true, expectId: 5 }), (e) => e.code === 'ETHEMEMISMATCH');
});
