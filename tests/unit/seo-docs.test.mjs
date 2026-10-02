// Every JSON block marked <!-- seo.json example --> in the protoblocks-seo skill docs must pass validateSeo,
// so the documented examples are proven valid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSeo } from '../../skills/protoblocks-site-builder/scripts/lib/seo.mjs';

const REFS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/protoblocks-seo/references');
const examples = (text) => [...text.matchAll(/<!-- seo\.json example -->\n```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);

test('inference.md carries seo.json examples and each passes validateSeo', () => {
  const blocks = examples(fs.readFileSync(path.join(REFS, 'inference.md'), 'utf8'));
  assert.ok(blocks.length >= 1, 'expected at least one seo.json example in inference.md');
  for (const b of blocks) assert.deepEqual(validateSeo(JSON.parse(b)), [], b);
});

test('every seo.json example in the skill references passes validateSeo', () => {
  let n = 0;
  for (const f of fs.readdirSync(REFS).filter((x) => x.endsWith('.md'))) {
    for (const b of examples(fs.readFileSync(path.join(REFS, f), 'utf8'))) {
      n += 1;
      assert.deepEqual(validateSeo(JSON.parse(b)), [], `${f}: ${b}`);
    }
  }
  assert.ok(n >= 2);
});

test('the extractor ignores unmarked JSON and catches an invalid example', () => {
  assert.deepEqual(examples('```json\n{}\n```'), []);
  const [bad] = examples('<!-- seo.json example -->\n```json\n{"focusKeyword":{"value":"A B","inferred":false}}\n```');
  assert.notDeepEqual(validateSeo(JSON.parse(bad)), []);
});
