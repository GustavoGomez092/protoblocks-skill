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
// Per-skill SKILL.md byte limits. The protoblocks authoring skill predates the 7 KB rule and is larger.
// CEILING, not a target: 14336 is the most it may ever reach. Do not raise it; move content into
// references/ instead.
const LIMITS = { protoblocks: 14336, 'protoblocks-section-loop': 8192 };

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
// Usage text as printed for a known-bad subcommand (scripts print usage and exit 64).
function usageOf(script) {
  if (!usageCache.has(script)) {
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), '__pbx__'], { encoding: 'utf8', timeout: 20000, cwd: os.tmpdir() });
    usageCache.set(script, `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  }
  return usageCache.get(script);
}

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const inUsageText = (usage, sub) => new RegExp(`(^|[\\s|<])${esc(sub)}([\\s|>]|$)`).test(usage);
// Dispatch patterns: cmd === 'x', case 'x', or a key of a commands map. A bare quoted token does not count.
export const dispatchesOn = (src, sub) => {
  const q = `['"]${esc(sub)}['"]`;
  return new RegExp(`(?:===?|case)\\s*${q}|^\\s*${q}\\s*:|^\\s*${esc(sub)}\\s*:`, 'm').test(src);
};
export const flagInSource = (src, flag) => new RegExp(`['"\`]${esc(flag)}['"\`\\s=]`).test(src);
export const flagInUsage = (usage, flag) => new RegExp(`(^|[^\\w-])${esc(flag)}(?![\\w-])`).test(usage);

test('strict matchers reject near misses', () => {
  const src = "if (cmd === 'add-frame') {}\nconst x = 'crop';\nargv.indexOf('--id');";
  assert.ok(dispatchesOn(src, 'add-frame'));
  assert.ok(!dispatchesOn(src, 'crop'), 'a bare quoted token is not a dispatch');
  assert.ok(flagInSource(src, '--id'));
  assert.ok(!flagInSource(src, '--idx'));
  assert.ok(!flagInUsage('Usage: x [--identity A]', '--id'));
  assert.ok(flagInUsage('Usage: x [--id N]', '--id'));
});

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
        assert.ok(inUsageText(usageOf(c.script), c.sub) || dispatchesOn(src, c.sub), `${rel}: "${c.sub}" is not a subcommand of ${c.script} (in: ${c.line})`);
      }
      for (const flag of c.flags) {
        assert.ok(flagInSource(src, flag) || flagInUsage(usageOf(c.script), flag), `${rel}: flag ${flag} not found in ${c.script} (in: ${c.line})`);
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
  const sections = (ns) => ns.map((n) => ({ n, anchor: `pb-s${n}`, status: 'planned', crops: {} }));
  updateState(theme, (s) => {
    // A decoy page first and non-contiguous section numbers: docs must look both up, not index them.
    for (const [slug, ns] of [['other', [1, 2]], ['home', [1, 3, 5]]]) {
      s.pages.push({ slug, title: slug, status: 'planning', postId: null, contentHash: null, design: { frames: [] }, sections: sections(ns) });
    }
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
        const page = s.pages.find((p) => p.slug === 'home');
        assert.equal(s.pages[0].status, 'planning', 'decoy page untouched');
        if (/page\.status/.test(block)) {
          assert.equal(page.status, 'building');
          assert.match(page.plan.approvedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
          assert.equal(page.plan.by, 'developer');
          const hero = page.sections.find((x) => x.n === 3);
          assert.equal(hero.decision, 'new');
          assert.ok(hero.label && hero.block);
          assert.equal(page.sections.find((x) => x.n === 1).block, 'site-header');
          assert.equal(page.sections.find((x) => x.n === 5).label, undefined);
        }
        if (/\$SI\.notes/.test(block)) assert.equal(page.sections.find((x) => x.n === 3).notes, 'Image right, CTA pair');
        if (/\.masks/.test(block)) assert.equal(page.sections.find((x) => x.n === 1).masks.desktop[0].w, 720);
        if (/shellCap/.test(block)) assert.match(page.notes.shellCap, /1600px/);
      } finally {
        fs.rmSync(theme, { recursive: true, force: true });
      }
    });
  });
}

test('at least the design-breakdown plan-gate blocks are executable', () => {
  const n = DOCS.filter((d) => d.skill === 'protoblocks-design-breakdown').flatMap((d) => runnableBlocks(fs.readFileSync(d.file, 'utf8'))).length;
  assert.ok(n >= 4, `expected >= 4 runnable blocks in protoblocks-design-breakdown, found ${n}`);
});
