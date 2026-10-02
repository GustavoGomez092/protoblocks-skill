import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeAttrs, blockComment } from '../../skills/protoblocks-site-builder/scripts/lib/blocks.mjs';

test('serializeAttrs escapes like WordPress', () => {
  assert.equal(serializeAttrs({}), '');
  assert.equal(serializeAttrs({ a: '--><script>&"' }), '{"a":"\\u002d\\u002d\\u003e\\u003cscript\\u003e\\u0026\\u0022"}');
});

test('serializeAttrs escapes each character class individually', () => {
  assert.equal(serializeAttrs({ a: 'x--y' }), '{"a":"x\\u002d\\u002dy"}');
  assert.equal(serializeAttrs({ a: '<' }), '{"a":"\\u003c"}');
  assert.equal(serializeAttrs({ a: '>' }), '{"a":"\\u003e"}');
  assert.equal(serializeAttrs({ a: '&' }), '{"a":"\\u0026"}');
  assert.equal(serializeAttrs({ a: '"' }), '{"a":"\\u0022"}');
});

test('blockComment self-closing and wrapping', () => {
  assert.equal(blockComment('navigation', { ref: 5 }), '<!-- wp:navigation {"ref":5} /-->');
  assert.equal(blockComment('proto-blocks/site-header', {}, 'X'), '<!-- wp:proto-blocks/site-header -->\nX\n<!-- /wp:proto-blocks/site-header -->');
});

test('blockComment without attrs self-closes and with attrs plus inner wraps', () => {
  assert.equal(blockComment('separator'), '<!-- wp:separator /-->');
  assert.equal(blockComment('group', { a: 1 }, 'Y'), '<!-- wp:group {"a":1} -->\nY\n<!-- /wp:group -->');
});

test('blockComment validates the block name', () => {
  for (const bad of ['', 'Foo', 'a b', 'a/b/c', '--> <script>', 'a/', '/a', undefined]) {
    assert.throws(() => blockComment(bad, {}), /block name/i, String(bad));
  }
  assert.equal(blockComment('core/group'), '<!-- wp:core/group /-->');
});
