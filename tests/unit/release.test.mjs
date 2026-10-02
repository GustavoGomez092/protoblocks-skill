import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readme = read('README.md');

test('plugin.json and marketplace.json versions are equal and 2.0.0', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, 'marketplace lists the plugin');
  assert.equal(plugin.version, entry.version);
  assert.equal(plugin.version, '2.0.0');
});

test('every command file is documented in the README', () => {
  const cmds = fs.readdirSync(path.join(ROOT, 'commands')).filter((f) => f.endsWith('.md'));
  assert.ok(cmds.length > 0);
  for (const f of cmds) assert.ok(readme.includes(`/protoblocks-skill:${f.replace(/\.md$/, '')}`), `README lacks ${f}`);
});

test('every skill directory is named in the README, and every README skill exists', () => {
  const skills = fs.readdirSync(path.join(ROOT, 'skills'));
  for (const s of skills) assert.ok(readme.includes(`\`${s}\``), `README lacks skill ${s}`);
  const named = [...readme.matchAll(/^\| `(protoblocks[\w-]*)` \|/gm)].map((m) => m[1]);
  assert.ok(named.length >= 7);
  for (const n of named) assert.ok(fs.existsSync(path.join(ROOT, 'skills', n, 'SKILL.md')), `skill ${n} missing`);
});

test('every /protoblocks-skill:<cmd> in the README has a command file', () => {
  const used = [...readme.matchAll(/\/protoblocks-skill:([\w-]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const c of used) assert.ok(fs.existsSync(path.join(ROOT, 'commands', `${c}.md`)), `commands/${c}.md missing`);
});

test('every npm run <x> in the README is a package.json script', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const used = [...readme.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const s of used) assert.ok(scripts[s], `npm script ${s} missing`);
});
