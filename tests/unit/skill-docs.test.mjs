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
const LIMITS = { protoblocks: 14336, 'protoblocks-section-loop': 8192, 'protoblocks-site-builder': 9728 };

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

// Executable doc blocks: <!-- test:run --> (or <!-- test:run fixture=<name> -->) immediately followed by a ```bash fence.
function runnableBlocks(text) {
  return [...text.matchAll(/<!-- test:run(?: fixture=([a-z]+))? -->\n```bash\n([\s\S]*?)\n```/g)].map((m) => ({ fixture: m[1] ?? 'default', block: m[2] }));
}

// default: a first page ("home") being planned. later: "home" is built and its header/footer live in the template
// parts (inPart), and a later page ("about") is being planned. approved: "home" has an approved plan but is still
// "planning" (status.mjs: build-page), and its header/footer sections are built but not yet in the parts.
function fixture(kind) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-docs-'));
  initState(theme, { url: 'https://x.local', path: theme });
  const sections = (ns) => ns.map((n) => ({ n, anchor: `pb-s${n}`, status: 'planned', crops: {} }));
  updateState(theme, (s) => {
    // A decoy page first and non-contiguous section numbers: docs must look both up, not index them.
    const pages = kind === 'later' ? [['other', [1, 2]], ['home', [1, 3, 5]], ['about', [1, 2, 4]]] : [['other', [1, 2]], ['home', [1, 3, 5]]];
    for (const [slug, ns] of pages) {
      s.pages.push({ slug, title: slug, status: 'planning', postId: null, contentHash: null, design: { frames: [] }, sections: sections(ns) });
    }
    if (kind === 'approved') {
      const home = s.pages[1];
      home.plan = { approvedAt: '2026-10-01T00:00:00.000Z', by: 'developer' };
      Object.assign(home.sections[0], { anchor: 'pb-header', label: 'Header', block: 'site-header', decision: 'new' });
      Object.assign(home.sections[1], { label: 'Hero', block: 'hero-split', decision: 'new' });
      Object.assign(home.sections[2], { anchor: 'pb-footer', label: 'Footer', block: 'site-footer', decision: 'new' });
    }
    if (kind === 'later') {
      const home = s.pages[1];
      home.status = 'building';
      home.plan = { approvedAt: '2026-10-01T00:00:00.000Z', by: 'developer' };
      Object.assign(home.sections[0], { anchor: 'pb-header', block: 'site-header', decision: 'new', inPart: true, status: 'done' });
      Object.assign(home.sections[1], { block: 'hero-split', decision: 'new', status: 'done' });
      Object.assign(home.sections[2], { anchor: 'pb-footer', block: 'site-footer', decision: 'new', inPart: true, status: 'done' });
    }
  });
  return theme;
}

for (const { file } of DOCS) {
  const rel = path.relative(ROOT, file);
  runnableBlocks(fs.readFileSync(file, 'utf8')).forEach(({ fixture: kind, block }, i) => {
    test(`runnable block ${i + 1} in ${rel} works against a temp state (${kind})`, () => {
      const theme = fixture(kind);
      try {
        const r = spawnSync('bash', ['-c', `set -e\n${block}`], { encoding: 'utf8', env: { ...process.env, PB: SCRIPTS, THEME: theme }, timeout: 60000 });
        assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}\n--- block ---\n${block}`);
        const s = loadState(theme);
        assert.deepEqual(validate(s), []);
        const page = s.pages.find((p) => p.slug === 'home');
        assert.equal(s.pages[0].status, 'planning', 'decoy page untouched');
        if (kind === 'later' && /plan\.mjs" record/.test(block)) {
          const about = s.pages.find((p) => p.slug === 'about');
          assert.equal(about.status, 'building');
          assert.match(about.plan.approvedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
          const pick = (n) => { const x = about.sections.find((y) => y.n === n); return [x.anchor, x.decision, x.inPart ?? false]; };
          assert.deepEqual([pick(1), pick(2), pick(4)], [['pb-header', 'reuse', true], ['pb-s2', 'new', false], ['pb-footer', 'reuse', true]]);
        } else if (/plan\.mjs" record/.test(block)) {
          assert.equal(page.status, 'building');
          assert.match(page.plan.approvedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
          assert.equal(page.plan.by, 'developer');
          const hero = page.sections.find((x) => x.n === 3);
          assert.equal(hero.decision, 'new');
          assert.ok(hero.label && hero.block);
          assert.equal(page.sections.find((x) => x.n === 1).block, 'site-header');
          assert.equal(page.sections.find((x) => x.n === 1).anchor, 'pb-header', 'header gets the fixed part anchor');
          assert.equal(page.sections.find((x) => x.n === 1).inPart, undefined, 'first page: built as a section first');
          assert.equal(page.sections.find((x) => x.n === 5).label, undefined);
        }
        if (kind === 'approved' && /status" '"building"'/.test(block)) assert.equal(page.status, 'building', 'build-page recipe sets the approved page building');
        if (/notes\.menu/.test(block)) assert.equal(page.notes.menu, 'declined', 'menu decline recorded by slug');
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
  const blocks = DOCS.filter((d) => d.skill === 'protoblocks-design-breakdown').flatMap((d) => runnableBlocks(fs.readFileSync(d.file, 'utf8')));
  const n = blocks.length;
  assert.ok(blocks.some((b) => b.fixture === 'default' && /plan\.mjs" record/.test(b.block)), 'first-page plan gate block');
  assert.ok(blocks.some((b) => b.fixture === 'later' && /plan\.mjs" record/.test(b.block)), 'later-page plan gate block');
  assert.ok(n >= 4, `expected >= 4 runnable blocks in protoblocks-design-breakdown, found ${n}`);
});

// Stage 4 final-review rules that live only in prose: keep them from silently disappearing.
test('section-loop and breakdown docs keep the stage-4 loop rules', () => {
  const read = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8');
  const loop = read('protoblocks-section-loop/SKILL.md');
  const verify = read('protoblocks-section-loop/references/verify.md');
  const build = read('protoblocks-section-loop/references/build.md');
  const hf = read('protoblocks-section-loop/references/header-footer.md');
  const bdSkill = read('protoblocks-design-breakdown/SKILL.md');
  const bd = read('protoblocks-design-breakdown/references/breakdown.md');
  const intake = read('protoblocks-design-breakdown/references/intake.md');
  // I4 Animate fallback
  assert.match(loop, /`protoblocks-motion` skill is not installed, set the status to `done`/);
  // I5 regress after editing a block used on other pages, before re-verifying (SKILL.md and verify.md agree)
  for (const [name, text] of [['SKILL.md', loop], ['verify.md', verify]]) {
    assert.match(text, /`usedOn`[^\n]{0,80}lists other pages[^\n]*regress\.mjs/, `${name}: regress after a shared-block edit`);
  }
  assert.match(loop, /pass: false`[^\n]*usedOn[^\n]*regress\.mjs[^\n]*before re-verifying/);
  // ENOTPAGE is not a --force case
  assert.match(loop, /`ENOTPAGE`[^\n]*not fixable with `--force`[^\n]*postId`? to `null`/);
  assert.doesNotMatch(loop, /`EFOREIGN`, `ENOTPAGE` mean/);
  assert.match(build, /\| `ENOTPAGE` \|[^\n]*`--force` cannot fix it/);
  // draft/private pages and anonymous QA
  assert.match(verify, /Draft or private page[^\n]*404[^\n]*Ask the developer[^\n]*--force/);
  // cap on resume
  assert.match(verify, /On resume, if the section's last `qa` record has `capReached: true`, ask the developer/);
  assert.match(loop, /capReached: true` on the last `qa` record \| ask the developer first/);
  assert.ok(loop.indexOf('`building` with `capReached: true`') < loop.indexOf('| `planned`, `building` | Build |'), 'specific capReached row comes before the general building row');
  // I3 part move runs once, after the last section passed
  assert.match(hf, /Run steps 1-8 once, when every section of the first page has passed Verify/);
  // I1 fixed anchors in the docs
  assert.match(hf, /markup "\$THEME" --from-state/);
  assert.doesNotMatch(hf + bdSkill + bd, /"anchor":"pb-s1"/);
  // segment / crop use the frame path from state, never a hard-coded desktop.png
  assert.doesNotMatch(bdSkill + intake, /design\/desktop\.png/);
  assert.match(bdSkill, /segment\.mjs" analyze "\$FRAME"/);
  // overlay header guidance
  assert.match(bd, /Overlay header on a full-bleed photo hero[^\n]*mask the photo region[^\n]*context of the hero/);
});
