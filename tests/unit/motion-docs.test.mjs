// Documented presets and options must exist in the runtime, and every runtime preset must be documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = fs.readFileSync(path.join(ROOT, 'skills/protoblocks-motion/references/presets.md'), 'utf8');
const RUNTIME = fs.readFileSync(path.join(ROOT, 'skills/protoblocks-site-builder/scripts/theme-assets/assets/js/pb-motion.js'), 'utf8');

const runtimeList = (name) => [...RUNTIME.match(new RegExp(`var ${name} = \\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
// First cell of every table row in the two preset tables (everything before the "Options" heading).
const presetsDoc = () => [...DOC.split('Options (all optional')[0].matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);

test('presets.md documents exactly the runtime presets', () => {
  const doc = presetsDoc();
  const runtime = [...runtimeList('REVEAL'), ...runtimeList('CONTINUOUS')];
  assert.ok(runtime.length >= 10);
  assert.deepEqual([...doc].sort(), [...runtime].sort());
});

test('every data-pb-* option named in the motion docs is read by the runtime', () => {
  const docs = ['SKILL.md', 'references/presets.md', 'references/custom-motion.md'].map((f) => fs.readFileSync(path.join(ROOT, 'skills/protoblocks-motion', f), 'utf8')).join('\n');
  const named = new Set([...docs.matchAll(/data-pb-([a-z-]+)/g)].map((m) => m[1]).filter((n) => n !== 'motion'));
  const read = new Set([...RUNTIME.matchAll(/'data-pb-([a-z-]+)'/g)].map((m) => m[1]));
  for (const n of named) assert.ok(read.has(n), `data-pb-${n} is documented but pb-motion.js never reads it`);
  for (const n of ['delay', 'stagger', 'start', 'distance', 'speed']) assert.ok(named.has(n), `option data-pb-${n} is not documented`);
});

test('every concrete data-pb-motion="<name>" attribute in the motion docs names a runtime preset', () => {
  const docs = ['SKILL.md', 'references/presets.md', 'references/custom-motion.md'].map((f) => fs.readFileSync(path.join(ROOT, 'skills/protoblocks-motion', f), 'utf8')).join('\n');
  const known = new Set([...runtimeList('REVEAL'), ...runtimeList('CONTINUOUS')]);
  const used = [...docs.matchAll(/data-pb-motion=\\?"([a-z-]+)\\?"/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  // "<preset>" and "<name>" placeholders do not match [a-z-]+; an unknown real name would.
  for (const u of used) assert.ok(known.has(u), `${u} is not a pb-motion preset`);
});

test('every hyphenated preset-like word in backticks in SKILL.md is a runtime preset', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/protoblocks-motion/SKILL.md'), 'utf8');
  const known = new Set([...runtimeList('REVEAL'), ...runtimeList('CONTINUOUS')]);
  const family = /^(fade|scale|clip|stagger|split|counter|parallax|marquee)\b/;
  const mentioned = [...skill.matchAll(/`([a-z]+(?:-[a-z]+)*)`/g)].map((m) => m[1]).filter((w) => family.test(w));
  assert.ok(mentioned.length >= 3, 'SKILL.md should name presets');
  for (const w of mentioned) assert.ok(known.has(w), `SKILL.md names "${w}", which is not a pb-motion preset`);
});

test('presets.md names the counter formats it promises', () => {
  for (const s of ['1,250+', '$4.9M', '98%', '4.5']) assert.ok(DOC.includes(`\`${s}\``), s);
});
