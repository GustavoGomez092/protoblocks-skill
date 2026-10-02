import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { recordPlan, PART_ANCHORS } from '../../skills/protoblocks-site-builder/scripts/lib/plan.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const PLAN_MJS = path.resolve('skills/protoblocks-site-builder/scripts/lib/plan.mjs');
const code = (c) => (e) => e.code === c;
const secs = (ns) => ns.map((n) => ({ n, anchor: `pb-s${n}`, status: 'planned', crops: {} }));

function setup(pages = [['home', [1, 3, 5]]]) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-plan-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  updateState(theme, (s) => {
    for (const [slug, ns, extra] of pages) s.pages.push({ slug, title: slug, status: 'planning', postId: null, contentHash: null, design: { frames: [] }, sections: secs(ns), ...extra });
  });
  return theme;
}
const firstPage = { page: 'home', sections: [
  { n: 1, label: 'Header', decision: 'new', block: 'site-header', part: 'header', notes: 'sticky' },
  { n: 3, label: 'Hero', decision: 'new', block: 'hero-split' },
  { n: 5, label: 'Footer', decision: 'new', block: 'site-footer', part: 'footer' },
] };

test('first page: header/footer get the fixed anchors pb-header/pb-footer, built as sections (no inPart)', () => {
  assert.deepEqual(PART_ANCHORS, { header: 'pb-header', footer: 'pb-footer' });
  const theme = setup();
  recordPlan(theme, firstPage);
  const page = loadState(theme).pages[0];
  assert.deepEqual(page.sections.map((s) => [s.n, s.anchor, s.decision, s.block, s.inPart ?? false, s.status]), [
    [1, 'pb-header', 'new', 'site-header', false, 'planned'],
    [3, 'pb-s3', 'new', 'hero-split', false, 'planned'],
    [5, 'pb-footer', 'new', 'site-footer', false, 'planned'],
  ]);
  assert.equal(page.sections[0].notes, 'sticky');
  assert.equal(page.status, 'building');
  assert.equal(page.plan.by, 'developer');
  assert.ok(!Number.isNaN(Date.parse(page.plan.approvedAt)));
});

test('later page: header/footer already in the template part are recorded reuse + inPart with the part anchor', () => {
  const theme = setup([
    ['home', [1, 2, 3], {}],
    ['about', [1, 2, 4], {}],
  ]);
  updateState(theme, (s) => {
    const h = s.pages[0].sections;
    Object.assign(h[0], { anchor: 'pb-header', block: 'site-header', decision: 'new', inPart: true, status: 'done' });
    Object.assign(h[2], { anchor: 'pb-footer', block: 'site-footer', decision: 'new', inPart: true, status: 'done' });
  });
  recordPlan(theme, { page: 'about', sections: [
    { n: 1, label: 'Header', decision: 'reuse', block: 'site-header', part: 'header' },
    { n: 2, label: 'Team', decision: 'new', block: 'team-grid' },
    { n: 4, label: 'Footer', decision: 'reuse', block: 'site-footer', part: 'footer' },
  ] });
  const about = loadState(theme).pages[1];
  const pick = (s) => ({ anchor: s.anchor, decision: s.decision, inPart: s.inPart ?? false, status: s.status });
  assert.deepEqual(pick(about.sections[0]), { anchor: 'pb-header', decision: 'reuse', inPart: true, status: 'building' });
  assert.deepEqual(pick(about.sections[1]), { anchor: 'pb-s2', decision: 'new', inPart: false, status: 'planned' });
  assert.deepEqual(pick(about.sections[2]), { anchor: 'pb-footer', decision: 'reuse', inPart: true, status: 'building' });
});

test('later page: planning the part section as anything but reuse is refused, nothing saved (EPLAN)', () => {
  const theme = setup([['home', [1]], ['about', [1, 2]]]);
  updateState(theme, (s) => { Object.assign(s.pages[0].sections[0], { anchor: 'pb-header', block: 'site-header', inPart: true, status: 'done' }); });
  const before = JSON.stringify(loadState(theme));
  assert.throws(() => recordPlan(theme, { page: 'about', sections: [{ n: 1, label: 'Header', decision: 'new', block: 'site-header', part: 'header' }] }), (e) => e.code === 'EPLAN' && /reuse/.test(e.message));
  assert.equal(JSON.stringify(loadState(theme)), before);
});

test('validation: missing page/section, bad decision, bad part, two headers, unsafe block are refused before saving', () => {
  const theme = setup();
  const before = JSON.stringify(loadState(theme));
  const bad = [
    [{ page: 'nope', sections: [] }, 'ENOPAGE'],
    [{ page: 'home', sections: [{ n: 2, label: 'X', decision: 'new', block: 'x' }] }, 'ENOSECTION'],
    [{ page: 'home', sections: [{ n: 1, label: 'X', decision: 'maybe', block: 'x' }] }, 'EPLAN'],
    [{ page: 'home', sections: [{ n: 1, label: 'X', decision: 'new', block: 'x', part: 'sidebar' }] }, 'EPLAN'],
    [{ page: 'home', sections: [{ n: 1, label: 'H', decision: 'new', block: 'site-header', part: 'header' }, { n: 3, label: 'H2', decision: 'new', block: 'site-header', part: 'header' }] }, 'EPLAN'],
    [{ page: 'home', sections: [{ n: 1, label: 'X', decision: 'new', block: '../x' }] }, 'EPLAN'],
    [{ page: 'home', sections: [{ n: 1.5, label: 'X', decision: 'new', block: 'x' }] }, 'EPLAN'],
    [{ page: '../x', sections: [] }, 'EINPUT'],
    [null, 'EPLAN'],
  ];
  for (const [plan, c] of bad) assert.throws(() => recordPlan(theme, plan), code(c), JSON.stringify(plan));
  assert.equal(JSON.stringify(loadState(theme)), before);
});

test('CLI: record <themeDir> <plan.json> prints the recorded sections; usage exits 64', () => {
  const theme = setup();
  const file = path.join(theme, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(firstPage));
  const r = spawnSync(process.execPath, [PLAN_MJS, 'record', theme, file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.page, 'home');
  assert.deepEqual(out.sections.map((s) => s.anchor), ['pb-header', 'pb-s3', 'pb-footer']);
  const u = spawnSync(process.execPath, [PLAN_MJS, 'nope'], { encoding: 'utf8' });
  assert.equal(u.status, 64);
  assert.match(u.stderr, /Usage: node plan\.mjs record/);
  const bad = spawnSync(process.execPath, [PLAN_MJS, 'record', theme, path.join(theme, 'missing.json')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^\[[A-Z]+\] /);
});
