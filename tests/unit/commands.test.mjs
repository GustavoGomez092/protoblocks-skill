// Slash commands: each has a description, and every script they run through ${CLAUDE_PLUGIN_ROOT} exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMMANDS = path.join(ROOT, 'commands');
const NAMES = ['setup-site', 'build-page', 'seo', 'resume'];

test('the four commands exist', () => {
  assert.deepEqual(fs.readdirSync(COMMANDS).filter((f) => f.endsWith('.md')).sort(), NAMES.map((n) => `${n}.md`).sort());
});

for (const name of NAMES) {
  const text = fs.readFileSync(path.join(COMMANDS, `${name}.md`), 'utf8');
  test(`commands/${name}.md has a description in its frontmatter`, () => {
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, 'missing frontmatter');
    assert.match(fm[1], /^description:\s*\S.{10,}$/m);
  });
  test(`commands/${name}.md only runs scripts that exist and states the persistence rule`, () => {
    const paths = [...text.matchAll(/node\s+"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/g)].map((m) => m[1]);
    assert.ok(paths.length > 0, 'no node "${CLAUDE_PLUGIN_ROOT}/..." command');
    for (const p of paths) assert.ok(fs.existsSync(path.join(ROOT, p)), `script not found: ${p}`);
    assert.match(text, /Shell variables do not persist between Bash commands/);
    assert.doesNotMatch(text, /--force(?![^\n]*without the developer)/, 'a --force may only appear as something never to add without OK');
  });
}

test('resume finds the theme with status.mjs --root, never "the active theme"', () => {
  const t = fs.readFileSync(path.join(COMMANDS, 'resume.md'), 'utf8');
  assert.match(t, /status\.mjs" --root/);
});

test('seo does not proceed while sections are open', () => {
  const t = fs.readFileSync(path.join(COMMANDS, 'seo.md'), 'utf8');
  assert.match(t, /do NOT proceed to SEO/);
  assert.match(t, /ESTATUS/);
});
