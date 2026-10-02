import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJsonld, JSONLD_META_KEY } from '../../skills/protoblocks-site-builder/scripts/lib/jsonld.mjs';

test('JSONLD_META_KEY matches the theme meta key', () => {
  assert.equal(JSONLD_META_KEY, '_proto_jsonld');
});

test('normalizeJsonld accepts a single node object and strips @context', () => {
  assert.deepEqual(
    normalizeJsonld({ '@context': 'https://schema.org', '@type': 'Service', name: 'A' }),
    [{ '@type': 'Service', name: 'A' }],
  );
});

test('normalizeJsonld accepts an array of nodes', () => {
  const out = normalizeJsonld([{ '@type': 'Question', name: 'Q' }, { '@type': 'Answer', text: 'A' }]);
  assert.deepEqual(out, [{ '@type': 'Question', name: 'Q' }, { '@type': 'Answer', text: 'A' }]);
});

test('normalizeJsonld unwraps @graph and strips @context from each node', () => {
  const out = normalizeJsonld({
    '@context': 'https://schema.org',
    '@graph': [{ '@context': 'https://schema.org', '@type': 'A' }, { '@type': 'B' }],
  });
  assert.deepEqual(out, [{ '@type': 'A' }, { '@type': 'B' }]);
});

test('normalizeJsonld does not mutate its input', () => {
  const input = [{ '@context': 'https://schema.org', '@type': 'Service', name: 'A' }];
  const snapshot = structuredClone(input);
  normalizeJsonld(input);
  assert.deepEqual(input, snapshot);
  const graph = { '@context': 'x', '@graph': [{ '@context': 'x', '@type': 'A' }] };
  const gSnap = structuredClone(graph);
  normalizeJsonld(graph);
  assert.deepEqual(graph, gSnap);
});

test('normalizeJsonld rejects non-object values', () => {
  for (const bad of ['x', 42, null, undefined, true]) {
    assert.throws(() => normalizeJsonld(bad), (e) => e.code === 'EJSONLD', String(bad));
  }
});

test('normalizeJsonld rejects non-object nodes', () => {
  for (const bad of [[1], ['x'], [null], [[{ '@type': 'A' }]], { '@graph': [1] }]) {
    assert.throws(() => normalizeJsonld(bad), (e) => e.code === 'EJSONLD', JSON.stringify(bad));
  }
});

test('normalizeJsonld rejects nodes missing @type', () => {
  for (const bad of [[{ name: 'no type' }], { name: 'no type' }, [{ '@type': 'A' }, { name: 'x' }], { '@graph': [{ '@type': '' }] }]) {
    assert.throws(() => normalizeJsonld(bad), (e) => e.code === 'EJSONLD', JSON.stringify(bad));
  }
});

test('normalizeJsonld rejects malformed @type values', () => {
  for (const t of [[], true, [''], {}, 5, [1], ['A', '']]) {
    assert.throws(() => normalizeJsonld([{ '@type': t }]), (e) => e.code === 'EJSONLD', JSON.stringify(t));
  }
});

test('normalizeJsonld accepts string and string-array @type', () => {
  assert.deepEqual(normalizeJsonld({ '@type': ['Service', 'Thing'] }), [{ '@type': ['Service', 'Thing'] }]);
  assert.deepEqual(normalizeJsonld({ '@type': 'Service' }), [{ '@type': 'Service' }]);
});
