// Documented presets and options must exist in the runtime, and every runtime preset must be documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
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

// The documented template helper prints attribute names from caller keys: they must be sanitized (sanitize_key), or a
// key with a quote or a space becomes a second attribute (an event handler).
const PHP_OK = (() => { try { return spawnSync('php', ['-v']).status === 0; } catch { return false; } })();
(PHP_OK ? test : test.skip)('SKILL.md $pb_motion helper sanitizes option names and escapes values', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/protoblocks-motion/SKILL.md'), 'utf8');
  const helper = skill.match(/```php\n([\s\S]*?\$pb_motion\s*=[\s\S]*?)\n```/)?.[1];
  assert.ok(helper, 'helper block not found');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-helper-'));
  const file = path.join(dir, 'h.php');
  fs.writeFileSync(file, `<?php
function esc_attr($s) { return htmlspecialchars((string) $s, ENT_QUOTES); }
function sanitize_key($k) { return preg_replace('/[^a-z0-9_\\-]/', '', strtolower((string) $k)); }
$block = array('blockName' => 'x');
${helper}
echo $pb_motion('fade-up', array('delay' => 0.15, 'X" onload="alert(1)' => 1, 'speed onclick=x' => 2)), "\\n";
echo $pb_motion('marquee'), "\\n";
$block = null;
${helper}
echo '[' . $pb_motion('fade-up') . ']', "\\n";
`);
  try {
    const r = spawnSync('php', [file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const [front, marquee, preview] = r.stdout.trim().split('\n');
    assert.match(front, /^data-pb-motion="fade-up" data-proto-animate="manual" data-pb-delay="0.15"/);
    assert.doesNotMatch(front, /\son\w+=/, `no injected attribute: ${front}`);
    assert.match(front, /data-pb-xonloadalert1="1"/);
    assert.match(front, /data-pb-speedonclickx="2"/);
    assert.equal(marquee, 'data-pb-motion="marquee"');
    assert.equal(preview, '[]', 'nothing in the editor preview');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const SKILL_DIR = path.join(ROOT, 'skills/protoblocks-motion');
const read = (f) => fs.readFileSync(path.join(SKILL_DIR, f), 'utf8');

test('SKILL.md commits a finished section as in spec 6.4: feat(page): <page> section <n>', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /commit -m "feat\(page\): <page> section <n>"/);
  assert.doesNotMatch(skill, /feat\(motion\)/);
});

test('shared blocks: SKILL.md states the reuse and usedOn rules and points to the recipe', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /`reuse`[^\n]*keep[^\n]*motion[^\n]*check/i);
  assert.match(skill, /usedOn/);
  assert.match(skill, /references\/shared-blocks\.md/);
});

// The recipe in shared-blocks.md lists, for a block, every usedOn page's done section using it (page, anchor, url).
test('shared-blocks.md recipe lists the done sections of a block on its usedOn pages', () => {
  const doc = read('references/shared-blocks.md');
  const block = doc.match(/<!-- test:run -->\n```bash\n([\s\S]*?)\n```/)?.[1];
  assert.ok(block && /BLOCK=/.test(block), 'runnable recipe with BLOCK= not found');
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-shared-'));
  try {
    fs.mkdirSync(path.join(theme, '.protoblocks'));
    const sec = (n, blk, status) => ({ n, anchor: `pb-s${n}`, block: blk, status });
    fs.writeFileSync(path.join(theme, '.protoblocks', 'build.json'), JSON.stringify({
      schemaVersion: 1, site: { url: 'http://a.local', path: '/x' },
      library: { 'hero-split': { usedOn: ['home', 'about', 'pricing'] }, other: { usedOn: ['home'] } },
      pages: [
        { slug: 'home', status: 'building', url: 'http://a.local/', sections: [sec(1, 'hero-split', 'done'), sec(2, 'other', 'done')] },
        { slug: 'about', status: 'done', url: 'http://a.local/about/', sections: [sec(1, 'site-header', 'done'), sec(3, 'hero-split', 'done'), sec(4, 'hero-split', 'animating')] },
        { slug: 'pricing', status: 'building', sections: [sec(2, 'hero-split', 'planned')] },
      ],
    }));
    const recipe = block.replace(/^BLOCK=.*$/m, 'BLOCK=hero-split');
    const r = spawnSync('bash', ['-c', `set -e\n${recipe}`], { encoding: 'utf8', env: { ...process.env, PB: path.join(ROOT, 'skills/protoblocks-site-builder/scripts'), THEME: theme } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['home pb-s1 http://a.local/', 'about pb-s3 http://a.local/about/']);
  } finally { fs.rmSync(theme, { recursive: true, force: true }); }
});

test('the intro overlay caveat for hero reveals is documented', () => {
  const doc = read('references/presets.md');
  assert.match(doc, /intro/i);
  assert.match(doc, /proto:intro-complete/);
  assert.match(doc, /protoIntroShown/);
});
