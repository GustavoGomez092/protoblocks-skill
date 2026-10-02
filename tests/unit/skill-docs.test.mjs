// Keeps skill docs honest: every documented command must exist, every subcommand must be in the
// script's usage, every flag must be in the script's source, frontmatter and size limits hold, and
// blocks marked <!-- test:run --> are executed against a throwaway build state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initState, updateState, loadState, validate } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS = path.join(ROOT, 'skills');
const SCRIPTS = path.join(SKILLS, 'protoblocks-site-builder', 'scripts');

const DEFAULT_LIMIT = 7168;
// Per-skill SKILL.md byte limits. The protoblocks authoring skill predates this limit and is larger.
const LIMITS = { protoblocks: 14336 };

function docFiles() {
  const out = [];
  for (const skill of fs.readdirSync(SKILLS)) {
    const dir = path.join(SKILLS, skill);
    if (!fs.statSync(dir).isDirectory()) continue;
    const main = path.join(dir, 'SKILL.md');
    if (fs.existsSync(main)) out.push({ skill, file: main });
    const refs = path.join(dir, 'references');
    if (fs.existsSync(refs)) for (const f of fs.readdirSync(refs).sort()) if (f.endsWith('.md')) out.push({ skill, file: path.join(refs, f) });
  }
  return out;
}

const DOCS = docFiles();
const CMD = /node\s+"(?:\$PB|\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/protoblocks-site-builder\/scripts)\/([\w/.-]+\.mjs)"([^\n`]*)/g;

export function extractCommands(text) {
  const cmds = [];
  for (const m of text.matchAll(CMD)) {
    const rest = m[2].replace(/\s#.*$/, '');
    const first = rest.trim().split(/\s+/)[0] ?? '';
    cmds.push({
      script: m[1],
      sub: /^[a-z][a-z-]*$/.test(first) ? first : null,
      flags: [...rest.matchAll(/(?:^|\s|\[)(--[a-z][\w-]*)/g)].map((x) => x[1]),
      line: m[0],
    });
  }
  return cmds;
}

const usageCache = new Map();
function usageOf(script) {
  if (!usageCache.has(script)) {
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { encoding: 'utf8', timeout: 20000, cwd: os.tmpdir() });
    usageCache.set(script, `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  }
  return usageCache.get(script);
}

test('extractCommands understands subcommands, flags and comments', () => {
  const [c] = extractCommands('node "$PB/lib/intake.mjs" add-frame "$THEME" p desktop a.png [--width W]  # --ignored\n');
  assert.deepEqual({ script: c.script, sub: c.sub, flags: c.flags }, { script: 'lib/intake.mjs', sub: 'add-frame', flags: ['--width'] });
  const [d] = extractCommands('node "${CLAUDE_PLUGIN_ROOT}/skills/protoblocks-site-builder/scripts/lib/setup-site.mjs" --name "X"');
  assert.deepEqual({ sub: d.sub, flags: d.flags }, { sub: null, flags: ['--name'] });
});

for (const { skill, file } of DOCS) {
  const rel = path.relative(ROOT, file);
  test(`commands in ${rel} exist and use real subcommands and flags`, () => {
    const text = fs.readFileSync(file, 'utf8');
    for (const c of extractCommands(text)) {
      const scriptFile = path.join(SCRIPTS, c.script);
      assert.ok(fs.existsSync(scriptFile), `${rel}: script not found: ${c.script} (in: ${c.line})`);
      const src = fs.readFileSync(scriptFile, 'utf8');
      if (c.sub) {
        // Scripts with a usage text must list the subcommand; scripts that print no usage (they fail
        // on missing args) must at least dispatch on it in their source.
        const usage = usageOf(c.script);
        const inUsage = new RegExp(`(^|[\\s|<])${c.sub}([\\s|>]|$)`).test(usage);
        const inSource = src.includes(`'${c.sub}'`) || src.includes(`"${c.sub}"`);
        assert.ok(inUsage || (!/usage/i.test(usage) && inSource), `${rel}: "${c.sub}" is not a subcommand of ${c.script} (in: ${c.line})`);
      }
      for (const flag of c.flags) {
        assert.ok(src.includes(flag) || src.includes(`'${flag.slice(2)}'`) || src.includes(`"${flag.slice(2)}"`), `${rel}: flag ${flag} not found in ${c.script} (in: ${c.line})`);
      }
    }
  });
}

for (const skill of fs.readdirSync(SKILLS).filter((s) => fs.existsSync(path.join(SKILLS, s, 'SKILL.md')))) {
  test(`${skill}/SKILL.md has frontmatter and fits its size limit`, () => {
    const file = path.join(SKILLS, skill, 'SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(m, 'missing frontmatter');
    const name = m[1].match(/^name:\s*(.+)$/m)?.[1].trim();
    const description = m[1].match(/^description:\s*(.+)$/m)?.[1].trim();
    assert.equal(name, skill, 'frontmatter name must equal the folder name');
    assert.ok(description && description.length > 20, 'frontmatter description missing or too short');
    const limit = LIMITS[skill] ?? DEFAULT_LIMIT;
    const size = Buffer.byteLength(text);
    assert.ok(size <= limit, `${skill}/SKILL.md is ${size} bytes; limit ${limit}`);
  });
}

// Executable doc blocks: <!-- test:run --> immediately followed by a ```bash fence.
function runnableBlocks(text) {
  return [...text.matchAll(/<!-- test:run -->\n```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}

function fixture() {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-docs-'));
  initState(theme, { url: 'https://x.local', path: theme });
  updateState(theme, (s) => {
    s.pages.push({
      slug: 'home', title: 'Home', status: 'planning', postId: null, contentHash: null, design: { frames: [] },
      sections: [1, 2, 3].map((n) => ({ n, anchor: `pb-s${n}`, status: 'planned', crops: {} })),
    });
  });
  return theme;
}

for (const { file } of DOCS) {
  const rel = path.relative(ROOT, file);
  runnableBlocks(fs.readFileSync(file, 'utf8')).forEach((block, i) => {
    test(`runnable block ${i + 1} in ${rel} works against a temp state`, () => {
      const theme = fixture();
      try {
        const r = spawnSync('bash', ['-c', `set -e\n${block}`], { encoding: 'utf8', env: { ...process.env, PB: SCRIPTS, THEME: theme }, timeout: 60000 });
        assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}\n--- block ---\n${block}`);
        const s = loadState(theme);
        assert.deepEqual(validate(s), []);
        const page = s.pages[0];
        if (/pages\.0\.status|page\.status/.test(block)) {
          assert.equal(page.status, 'building');
          assert.match(page.plan.approvedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
          assert.equal(page.plan.by, 'developer');
          assert.equal(page.sections[0].decision, 'new');
          assert.ok(page.sections[0].label && page.sections[0].block);
        }
        if (/\.masks/.test(block)) assert.equal(page.sections[0].masks.desktop[0].w, 720);
        if (/shellCap/.test(block)) assert.match(page.notes.shellCap, /1600px/);
      } finally {
        fs.rmSync(theme, { recursive: true, force: true });
      }
    });
  });
}

test('at least the design-breakdown plan-gate blocks are executable', () => {
  const n = DOCS.filter((d) => d.skill === 'protoblocks-design-breakdown').flatMap((d) => runnableBlocks(fs.readFileSync(d.file, 'utf8'))).length;
  assert.ok(n >= 3, `expected >= 3 runnable blocks in protoblocks-design-breakdown, found ${n}`);
});
