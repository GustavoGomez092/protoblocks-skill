import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partMarkup, writePart, removeOverride } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';

test('partMarkup wraps core/navigation inside the proto-block', () => {
  assert.equal(
    partMarkup({ block: 'proto-blocks/site-header', attrs: { sticky: true }, navRef: 12 }),
    '<!-- wp:proto-blocks/site-header {"sticky":true} -->\n<!-- wp:navigation {"ref":12} /-->\n<!-- /wp:proto-blocks/site-header -->\n',
  );
  assert.equal(partMarkup({ block: 'proto-blocks/site-footer' }), '<!-- wp:proto-blocks/site-footer /-->\n');
});

test('partMarkup ignores a non-numeric navRef', () => {
  assert.equal(partMarkup({ block: 'proto-blocks/site-footer', navRef: '12' }), '<!-- wp:proto-blocks/site-footer /-->\n');
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

test('removeOverride refuses without confirm', () => {
  let calls = 0;
  const wp = { evalFile: () => { calls += 1; throw new Error('must not be called'); } };
  assert.throws(() => removeOverride(wp, 'header', {}), (e) => e.code === 'ECONFIRM' && /Site Editor/.test(e.message));
  assert.throws(() => removeOverride(wp, 'header'), (e) => e.code === 'ECONFIRM');
  assert.equal(calls, 0);
});
