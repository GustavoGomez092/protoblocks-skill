import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nextAction, summarize, ACTIONS } from '../../skills/protoblocks-site-builder/scripts/lib/status.mjs';
import { initState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const SCRIPT = new URL('../../skills/protoblocks-site-builder/scripts/lib/status.mjs', import.meta.url).pathname;
const base = (pages) => ({ schemaVersion: 1, site: { url: 'http://a.local', path: '/x', theme: { slug: 'acme' } }, library: {}, pages });
const sec = (n, status, extra = {}) => ({ n, anchor: `pb-s${n}`, status, ...extra });

test('no state → setup', () => assert.equal(nextAction(null).action, 'setup'));

test('planning without approval → breakdown; with approval → build-page', () => {
  assert.equal(nextAction(base([{ slug: 'home', status: 'planning', sections: [] }])).action, 'breakdown');
  assert.equal(nextAction(base([{ slug: 'home', status: 'planning', plan: { approvedAt: 'x' }, sections: [sec(1, 'planned')] }])).action, 'build-page');
});

test('section sub-phases resume from status', () => {
  const p = (s) => base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'done'), sec(2, s), sec(3, 'planned')] }]);
  assert.deepEqual([nextAction(p('planned')).action, nextAction(p('planned')).section], ['section-build', 2]);
  assert.equal(nextAction(p('building')).action, 'section-build');
  assert.equal(nextAction(p('verifying')).action, 'section-verify');
  assert.equal(nextAction(p('animating')).action, 'section-animate');
});

test('skipped sections do not block page QA; page QA pass → seo', () => {
  const pg = { slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'done'), sec(2, 'skipped')] };
  assert.equal(nextAction(base([pg])).action, 'page-qa');
  assert.equal(nextAction(base([{ ...pg, status: 'seo', pageQa: { pass: true } }])).action, 'seo');
});

test('multi-page: next page breakdown, then ask-more-pages', () => {
  const done = { slug: 'home', status: 'done', plan: { approvedAt: 'x' }, sections: [sec(1, 'done')] };
  assert.deepEqual([nextAction(base([done, { slug: 'about', status: 'planning', sections: [] }])).action, nextAction(base([done, { slug: 'about', status: 'planning', sections: [] }])).page], ['breakdown', 'about']);
  assert.equal(nextAction(base([done])).action, 'ask-more-pages');
});

test('summarize lists sections with iteration counts and last pass', () => {
  const s = base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(1, 'building', { label: 'Hero', block: 'hero', qa: [{ iteration: 1, pass: false }, { iteration: 2, pass: false }] })] }]);
  const sum = summarize(s);
  assert.deepEqual(sum.pages[0].sections[0], { n: 1, label: 'Hero', block: 'hero', status: 'building', iterations: 2, lastPass: false });
  assert.equal(sum.next.action, 'section-build');
});

test('each action carries page, section and why where applicable', () => {
  const bp = nextAction(base([{ slug: 'home', status: 'planning', plan: { approvedAt: 'x' }, sections: [sec(1, 'planned')] }]));
  assert.deepEqual([bp.action, bp.page, typeof bp.why], ['build-page', 'home', 'string']);
  const sv = nextAction(base([{ slug: 'home', status: 'building', sections: [sec(1, 'verifying')] }]));
  assert.deepEqual([sv.action, sv.page, sv.section], ['section-verify', 'home', 1]);
  const sa = nextAction(base([{ slug: 'home', status: 'building', sections: [sec(1, 'animating')] }]));
  assert.deepEqual([sa.action, sa.page, sa.section], ['section-animate', 'home', 1]);
  const qa = nextAction(base([{ slug: 'home', status: 'building', sections: [sec(1, 'done')] }]));
  assert.deepEqual([qa.action, qa.page], ['page-qa', 'home']);
});

test('sections out of order by n: lowest open n is chosen', () => {
  const pg = { slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(3, 'planned'), sec(1, 'done'), sec(2, 'verifying')] };
  const r = nextAction(base([pg]));
  assert.deepEqual([r.action, r.section], ['section-verify', 2]);
  assert.deepEqual(summarize(base([pg])).pages[0].sections.map((s) => s.n), [1, 2, 3]);
});

test('seo page with open sections still goes to seo', () => {
  const pg = { slug: 'home', status: 'seo', sections: [sec(1, 'done'), sec(2, 'building')] };
  const r = nextAction(base([pg]));
  assert.deepEqual([r.action, r.page, r.section], ['seo', 'home', undefined]);
});

test('page QA not passed with all sections closed stays page-qa; pass flag false does not skip', () => {
  const pg = { slug: 'home', status: 'building', sections: [sec(1, 'done')], pageQa: { pass: false } };
  assert.equal(nextAction(base([pg])).action, 'page-qa');
  assert.equal(nextAction(base([{ ...pg, pageQa: { pass: true } }])).action, 'seo');
});

test('empty pages array → ask-more-pages', () => {
  const r = nextAction(base([]));
  assert.equal(r.action, 'ask-more-pages');
  assert.equal(r.page, undefined);
});

test('summarize: no qa entries gives 0 iterations and null lastPass; last pass true', () => {
  const s = base([{ slug: 'home', status: 'building', sections: [sec(1, 'planned'), sec(2, 'done', { qa: [{ iteration: 1, pass: false }, { iteration: 1, pass: false }, { iteration: 2, pass: true }] })] }]);
  const [a, b] = summarize(s).pages[0].sections;
  assert.deepEqual([a.iterations, a.lastPass, a.label, a.block], [0, null, null, null]);
  assert.deepEqual([b.iterations, b.lastPass], [2, true]);
  assert.deepEqual(summarize(s).site, { url: 'http://a.local', theme: 'acme' });
});

test('CLI: missing state file prints setup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  const r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).next.action, 'setup');
});

test('CLI: existing state prints summary; no arg exits 64', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  initState(dir, { url: 'http://a.local', path: '/x', theme: { slug: 'acme' } });
  const r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.site.theme, out.next.action], ['acme', 'ask-more-pages']);
  assert.equal(spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status, 64);
});

test('building page with zero sections → breakdown', () => {
  const r = nextAction(base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [] }]));
  assert.deepEqual(r, { action: 'breakdown', page: 'home', why: 'building page has no sections' });
});

test('planning page with approved plan but zero sections → breakdown', () => {
  const r = nextAction(base([{ slug: 'home', status: 'planning', plan: { approvedAt: 'x' }, sections: [] }]));
  assert.deepEqual(r, { action: 'breakdown', page: 'home', why: 'approved plan has no sections' });
});

test('summarize ignores null / iteration-less qa entries', () => {
  const s = base([{ slug: 'home', status: 'building', sections: [sec(1, 'building', { qa: [null, { iteration: 1, pass: false }, {}, { iteration: 2, pass: true }, null] })] }]);
  const [x] = summarize(s).pages[0].sections;
  assert.deepEqual([x.iterations, x.lastPass], [2, true]);
});

test('nextAction and summarize do not mutate their input', () => {
  const s = base([{ slug: 'home', status: 'building', plan: { approvedAt: 'x' }, sections: [sec(3, 'planned'), sec(1, 'done', { qa: [{ iteration: 1, pass: true }] })] }]);
  const before = structuredClone(s);
  nextAction(s); summarize(s);
  assert.deepEqual(s, before);
});

test('CLI: nonexistent themeDir exits 1 with ENOTHEME', () => {
  const r = spawnSync('node', [SCRIPT, '/nonexistent/theme-dir-xyz'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[ENOTHEME\] \/nonexistent\/theme-dir-xyz is not a directory/);
});

test('CLI: corrupt build.json exits 1 with EPARSE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(dir, '.protoblocks'));
  fs.writeFileSync(path.join(dir, '.protoblocks', 'build.json'), '{not json');
  const r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[EPARSE\]/);
});

// The orchestrator docs cannot drift from the state machine: ACTIONS is exactly what nextAction returns, and every
// action has its own row in the SKILL.md action table and its own section in references/pipeline.md.
test('ACTIONS lists exactly the actions nextAction returns', () => {
  const pg = (status, sections, extra = {}) => ({ slug: 'home', status, sections, ...extra });
  const states = [
    null,
    base([]),
    base([pg('planning', [])]),
    base([pg('planning', [sec(1, 'planned')], { plan: { approvedAt: 'x' } })]),
    ...['planned', 'building', 'verifying', 'animating'].map((st) => base([pg('building', [sec(1, st)], { plan: { approvedAt: 'x' } })])),
    base([pg('building', [sec(1, 'done')], { plan: { approvedAt: 'x' } })]),
    base([pg('seo', [sec(1, 'done')], { pageQa: { pass: true } })]),
  ];
  assert.deepEqual([...new Set(states.map((s) => nextAction(s).action))].sort(), [...ACTIONS].sort());
  assert.ok(Object.isFrozen(ACTIONS));
});

test('every action has a row in the orchestrator SKILL.md action table and a pipeline.md section', () => {
  const dir = new URL('../../skills/protoblocks-site-builder/', import.meta.url).pathname;
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const table = skill.split(/^## Actions$/m)[1]?.split(/^## /m)[0] ?? '';
  const firstCells = table.split('\n').filter((l) => l.startsWith('| `')).map((l) => l.split('|')[1]);
  const rowActions = firstCells.flatMap((c) => [...c.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]));
  for (const a of ACTIONS) assert.ok(rowActions.includes(a), `SKILL.md "## Actions" table has no row for \`${a}\``);
  for (const a of rowActions) assert.ok(ACTIONS.includes(a), `SKILL.md action table row \`${a}\` is not an action nextAction returns`);
  const pipeline = fs.readFileSync(path.join(dir, 'references', 'pipeline.md'), 'utf8');
  for (const a of ACTIONS) assert.match(pipeline, new RegExp(`^### \`${a}\``, 'm'), `pipeline.md has no "### \`${a}\`" section`);
});
