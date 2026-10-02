import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partMarkup, writePart, removeOverride, listOverrides } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';

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
    assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: c }), (e) => e.code === 'ECONFIRM');
    assert.ok(wp.calls.every((a) => a[0] === 'preview'));
  }
});

test('removeOverride with confirm passes theme, slug and an explicit confirm arg, returns records', () => {
  const wp = fakeWp();
  const r = removeOverride(wp, 'pb-itest', 'header', { confirm: true });
  assert.deepEqual(wp.calls.at(-1), ['remove-override', 'pb-itest', 'header', 'confirm']);
  assert.deepEqual(r, { removed: [5], records: [ROW] });
});

test('removeOverride rejects invalid slugs before any WP call', () => {
  for (const slug of ['Header', '../header', '--confirm', ' header', 'a/b', '', 'a--b', '-a', 'a-']) {
    const wp = { evalFile: () => { throw new Error('must not be called'); } };
    assert.throws(() => removeOverride(wp, 'pb-itest', slug, { confirm: true }), (e) => e.code === 'ESLUG', JSON.stringify(slug));
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
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true }), (e) => e.code === 'EAMBIGUOUS' && /5/.test(e.message) && /6/.test(e.message));
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});

test('removeOverride refuses rows that belong to another theme', () => {
  const wp = fakeWp([{ ...ROW, theme: 'twentytwentyfive' }]);
  assert.throws(() => removeOverride(wp, 'pb-itest', 'header', { confirm: true }), (e) => e.code === 'ETHEMEMISMATCH');
  assert.ok(wp.calls.every((a) => a[0] === 'preview'));
});
