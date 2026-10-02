import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCheckInput, prepareCheck, recordVerdict, validateVerdict } from '../../skills/protoblocks-site-builder/scripts/lib/qa-input.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

function setup(max = 2) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-qi-'));
  initState(theme, { url: 'http://a.local', path: '/x', qa: { maxIterations: max } });
  updateState(theme, (s) => {
    s.pages.push({ slug: 'home', status: 'building', url: 'http://a.local/home/', postId: 3, contentHash: 'h',
      design: { frames: [{ breakpoint: 'desktop', width: 1440, scale: 2, image: '/d.png' }] },
      sections: [{ n: 1, anchor: 'pb-s1', block: 'hero', status: 'building', crops: { desktop: '/c/pb-s1.png' }, qa: [] }] });
  });
  return theme;
}

const verdict = (pass, extra = {}) => ({ pass, anchor: 'pb-s1', numericPass: pass,
  breakpoints: [{ name: 'desktop', mode: 'diff', mismatch: pass ? 0.03 : 0.2, heightDelta: 0.01, widthDelta: 0, numericPass: pass, status: 200 },
    { name: 'tablet', mode: 'sanity', ok: true, widthDelta: 0, numericPass: true },
    { name: 'mobile', mode: 'sanity', ok: true, widthDelta: 0, numericPass: true }],
  discrepancies: pass ? [] : [{ breakpoint: 'desktop', area: 'h1', issue: 'x', severity: 'high', fix: 'y' }], artifacts: [], ...extra });
const errVerdict = () => ({ pass: false, anchor: 'pb-s1', numericPass: false, error: '[EINPUT] boom' });
// What check-section would have written for this verdict (result.json uses `breakpoint`, the verdict `name`).
const resultFor = (v) => ({ anchor: v.anchor ?? 'pb-s1', url: 'http://a.local/home/', numericPass: v.numericPass,
  results: v.breakpoints.map(({ name, mode, mismatch, heightDelta, widthDelta, numericPass }) => ({ breakpoint: name, mode, mismatch, heightDelta, widthDelta, numericPass, ...(mode === 'diff' ? { fullyMasked: false } : {}) })) });
const writeResult = (dir, r) => fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(r));
// Writes the verdict and (unless result: false or an error verdict) the matching result.json.
const writeV = (dir, v, name = 'verdict.json', { result = true } = {}) => {
  if (result && v?.error === undefined && Array.isArray(v?.breakpoints)) writeResult(dir, resultFor(v));
  const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(v)); return f;
};
const code = (c) => (e) => e.code === c;

test('buildCheckInput: diff for framed breakpoints, sanity for the rest, iteration numbering', () => {
  const theme = setup();
  const input = buildCheckInput(loadState(theme), theme, 'home', 1);
  assert.equal(input.url, 'http://a.local/home/');
  assert.equal(input.anchor, 'pb-s1');
  assert.deepEqual(input.qa, { mismatchMax: 0.08, heightDeltaMax: 0.03 });
  assert.deepEqual(input.breakpoints[0], { name: 'desktop', width: 1440, scale: 2, design: '/c/pb-s1.png', masks: [] });
  assert.deepEqual(input.breakpoints.slice(1).map((b) => [b.name, b.width, b.sanityOnly]), [['tablet', 834, true], ['mobile', 390, true]]);
  assert.ok(input.iterDir.endsWith(path.join('artifacts', 'home', 'pb-s1', 'iter-1')));
});

test('buildCheckInput output satisfies check-section validation rules (replicated: validate() is not exported)', () => {
  const theme = setup();
  const input = buildCheckInput(loadState(theme), theme, 'home', 1);
  assert.match(input.anchor, /^[A-Za-z][A-Za-z0-9_-]*$/);
  assert.ok(/^https?:$/.test(new URL(input.url).protocol));
  assert.ok(typeof input.iterDir === 'string' && input.iterDir);
  assert.ok(Number.isFinite(input.qa.mismatchMax) && Number.isFinite(input.qa.heightDeltaMax));
  assert.ok(input.breakpoints.length > 0);
  const names = new Set();
  for (const bp of input.breakpoints) {
    assert.match(bp.name, /^[A-Za-z0-9_-]+$/);
    assert.ok(!names.has(bp.name)); names.add(bp.name);
    assert.ok(Number.isFinite(bp.width) && bp.width > 0);
    if (bp.scale !== undefined) assert.ok(bp.scale > 0);
    if (bp.masks !== undefined) assert.ok(Array.isArray(bp.masks));
  }
});

test('buildCheckInput throws without a page url or without crops', () => {
  const theme = setup();
  updateState(theme, (s) => { s.pages[0].sections[0].crops = {}; });
  assert.throws(() => buildCheckInput(loadState(theme), theme, 'home', 1), /no design crops/);
  updateState(theme, (s) => { s.pages[0].sections[0].crops = { desktop: '/c' }; delete s.pages[0].url; });
  assert.throws(() => buildCheckInput(loadState(theme), theme, 'home', 1), /no URL/);
});

test('slug and n are validated (EINPUT)', () => {
  const theme = setup();
  const st = loadState(theme);
  for (const slug of ['../evil', 'a/b', '', '.hidden', 'a b']) assert.throws(() => buildCheckInput(st, theme, slug, 1), code('EINPUT'), slug);
  for (const n of [0, -1, 1.5, 'x', '../1', NaN, '1e3']) assert.throws(() => buildCheckInput(st, theme, 'home', n), code('EINPUT'), String(n));
  assert.doesNotThrow(() => buildCheckInput(st, theme, 'home', '1'));
});

test('a tampered section anchor cannot escape artifacts (EINPUT)', () => {
  const theme = setup();
  for (const anchor of ['../../../../evil', 'a/b']) {
    updateState(theme, (s) => { s.pages[0].sections[0].anchor = anchor; });
    assert.throws(() => buildCheckInput(loadState(theme), theme, 'home', 1), code('EINPUT'), anchor);
  }
});

test('iterDir behind a symlink out of artifacts is rejected (EINPUT)', () => {
  const theme = setup();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-out-'));
  const art = path.join(theme, '.protoblocks', 'artifacts');
  fs.mkdirSync(art, { recursive: true });
  fs.symlinkSync(outside, path.join(art, 'home'));
  assert.throws(() => prepareCheck(theme, 'home', 1), code('EINPUT'));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('validateVerdict rejects pass with failing numbers or high discrepancies', () => {
  assert.deepEqual(validateVerdict(verdict(true)), []);
  assert.ok(validateVerdict({ ...verdict(true), numericPass: false }).length);
  assert.ok(validateVerdict({ ...verdict(true), discrepancies: [{ severity: 'high' }] }).length);
});

test('validateVerdict: any breakpoint with numericPass false (incl. sanity) blocks pass', () => {
  const v = verdict(true);
  v.breakpoints[1].numericPass = false;
  assert.ok(validateVerdict(v).length);
  const d = verdict(true);
  d.breakpoints[0].numericPass = false;
  assert.ok(validateVerdict(d).length);
});

test('validateVerdict: numericPass must be boolean on every breakpoint', () => {
  const v = verdict(false);
  delete v.breakpoints[1].numericPass;
  assert.ok(validateVerdict(v).length);
  const w = verdict(false);
  delete w.breakpoints[0].numericPass;
  assert.ok(validateVerdict(w).length);
});

test('validateVerdict: unsafe/duplicate breakpoint names and bad modes are rejected', () => {
  const v = verdict(false);
  v.breakpoints[0].name = '../../x';
  assert.ok(validateVerdict(v).length);
  const d = verdict(false);
  d.breakpoints[1].name = 'desktop';
  assert.ok(validateVerdict(d).length);
  const m = verdict(false);
  m.breakpoints[0].mode = 'weird';
  assert.ok(validateVerdict(m).length);
  assert.ok(validateVerdict({ ...verdict(false), breakpoints: [] }).length);
});

test('validateVerdict accepts a per-breakpoint error-mode result (check-section emits mode "error")', () => {
  const v = verdict(false);
  v.breakpoints[2] = { name: 'mobile', mode: 'error', error: 'boom', numericPass: false };
  assert.deepEqual(validateVerdict(v), []);
  v.pass = true; v.numericPass = true; v.discrepancies = [];
  assert.ok(validateVerdict(v).length);
});

test('validateVerdict accepts the error-shaped verdict and rejects a passing one', () => {
  assert.deepEqual(validateVerdict(errVerdict()), []);
  assert.ok(validateVerdict({ ...errVerdict(), pass: true }).length);
  assert.ok(validateVerdict({ ...errVerdict(), numericPass: true }).length);
  assert.ok(validateVerdict(null).length);
});

test('recordVerdict: fail → building and cap; pass → animating with baselines', () => {
  const theme = setup();
  const { input } = prepareCheck(theme, 'home', 1);
  const iterDir = path.dirname(input);
  const r1 = recordVerdict(theme, 'home', 1, writeV(iterDir, verdict(false)));
  assert.deepEqual([r1.pass, r1.iteration, r1.capReached, r1.status], [false, 1, false, 'building']);

  const p2 = prepareCheck(theme, 'home', 1);
  assert.equal(p2.iteration, 2);
  const dir2 = path.dirname(p2.input);
  assert.equal(recordVerdict(theme, 'home', 1, writeV(dir2, verdict(false))).capReached, true);

  const p3 = prepareCheck(theme, 'home', 1);
  const dir3 = path.dirname(p3.input);
  fs.writeFileSync(path.join(dir3, 'desktop-render.png'), 'png');
  const r3 = recordVerdict(theme, 'home', 1, writeV(dir3, verdict(true)));
  assert.equal(r3.status, 'animating');
  const st = loadState(theme);
  assert.equal(st.pages[0].sections[0].qa.filter((q) => q.iteration === 3).length, 3);
  assert.equal(st.library.hero.baselines[0].breakpoint, 'desktop');
  assert.ok(fs.existsSync(st.library.hero.baselines[0].file));

  const forged = writeV(dir3, { ...verdict(true), numericPass: false }, 'forged.json');
  assert.throws(() => recordVerdict(theme, 'home', 1, forged), code('EVERDICT'));
});

test('recordVerdict stores widthDelta, numericPass and status per breakpoint', () => {
  const theme = setup();
  const dir = path.dirname(prepareCheck(theme, 'home', 1).input);
  const v = verdict(false);
  v.breakpoints[0].widthDelta = 3;
  recordVerdict(theme, 'home', 1, writeV(dir, v));
  const q = loadState(theme).pages[0].sections[0].qa;
  assert.deepEqual(q[0], { iteration: 1, breakpoint: 'desktop', mode: 'diff', mismatch: 0.2, heightDelta: 0.01, widthDelta: 3, numericPass: false, status: 200, pass: false, verdict: path.join(dir, 'verdict.json') });
  assert.equal(q[2].breakpoint, 'mobile');
  assert.equal(q[2].numericPass, true);
  assert.equal('mismatch' in q[2], false);
});

test('error verdicts are recorded but never consume an iteration (cap ignores them)', () => {
  const theme = setup(2);
  const dir1 = path.dirname(prepareCheck(theme, 'home', 1).input);
  const r1 = recordVerdict(theme, 'home', 1, writeV(dir1, errVerdict()));
  assert.deepEqual([r1.pass, r1.capReached, r1.status, r1.iteration], [false, false, 'verifying', 1]);
  assert.equal(loadState(theme).pages[0].sections[0].status, 'verifying');
  const q = loadState(theme).pages[0].sections[0].qa;
  assert.equal(q.length, 1);
  assert.equal(q[0].status, 'error');
  assert.equal(q[0].pass, false);

  // two more errors: still no cap with maxIterations 2
  const dir2 = path.dirname(prepareCheck(theme, 'home', 1).input);
  assert.equal(recordVerdict(theme, 'home', 1, writeV(dir2, errVerdict())).capReached, false);
  const dir3 = path.dirname(prepareCheck(theme, 'home', 1).input);
  assert.equal(recordVerdict(theme, 'home', 1, writeV(dir3, errVerdict())).capReached, false);

  // one real failure after errors is attempt 1 of 2, not the 4th
  const dir4 = path.dirname(prepareCheck(theme, 'home', 1).input);
  assert.equal(recordVerdict(theme, 'home', 1, writeV(dir4, verdict(false))).capReached, false);
  const dir5 = path.dirname(prepareCheck(theme, 'home', 1).input);
  assert.equal(recordVerdict(theme, 'home', 1, writeV(dir5, verdict(false))).capReached, true);
  // an error verdict after the cap never reports capReached itself
  const dir6 = path.dirname(prepareCheck(theme, 'home', 1).input);
  assert.equal(recordVerdict(theme, 'home', 1, writeV(dir6, errVerdict())).capReached, false);
});

test('recordVerdict only accepts verdict files inside the section iter dir tree (EVERDICT)', () => {
  const theme = setup();
  const dir = path.dirname(prepareCheck(theme, 'home', 1).input);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-v-'));
  assert.throws(() => recordVerdict(theme, 'home', 1, writeV(outside, verdict(false))), code('EVERDICT'));
  // another section's / page's iter dir
  const other = path.join(theme, '.protoblocks', 'artifacts', 'home', 'pb-s9', 'iter-1');
  fs.mkdirSync(other, { recursive: true });
  assert.throws(() => recordVerdict(theme, 'home', 1, writeV(other, verdict(false))), code('EVERDICT'));
  // dir not named iter-<k>
  const odd = path.join(theme, '.protoblocks', 'artifacts', 'home', 'pb-s1', 'misc');
  fs.mkdirSync(odd, { recursive: true });
  assert.throws(() => recordVerdict(theme, 'home', 1, writeV(odd, verdict(false))), code('EVERDICT'));
  // traversal through the iter dir
  fs.writeFileSync(path.join(outside, 'v.json'), JSON.stringify(verdict(false)));
  assert.throws(() => recordVerdict(theme, 'home', 1, path.join(dir, path.relative(dir, path.join(outside, 'v.json')))), code('EVERDICT'));
  // missing / unparsable file
  assert.throws(() => recordVerdict(theme, 'home', 1, path.join(dir, 'nope.json')), code('EVERDICT'));
  fs.writeFileSync(path.join(dir, 'bad.json'), '{');
  assert.throws(() => recordVerdict(theme, 'home', 1, path.join(dir, 'bad.json')), code('EVERDICT'));
  assert.equal(loadState(theme).pages[0].sections[0].qa.length, 0);
});

test('recordVerdict rejects a verdict for a different anchor (EVERDICT)', () => {
  const theme = setup();
  const dir = path.dirname(prepareCheck(theme, 'home', 1).input);
  assert.throws(() => recordVerdict(theme, 'home', 1, writeV(dir, verdict(false, { anchor: 'pb-s2' }))), code('EVERDICT'));
});

test('recordVerdict: a symlinked verdict pointing outside is rejected (EVERDICT)', () => {
  const theme = setup();
  const dir = path.dirname(prepareCheck(theme, 'home', 1).input);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-v-'));
  const real = writeV(outside, verdict(false));
  fs.symlinkSync(real, path.join(dir, 'link.json'));
  assert.throws(() => recordVerdict(theme, 'home', 1, path.join(dir, 'link.json')), code('EVERDICT'));
});

test('prepareCheck never overwrites an existing input.json: bumps k', () => {
  const theme = setup();
  const a = prepareCheck(theme, 'home', 1);
  fs.writeFileSync(a.input, '{"marker":1}');
  const b = prepareCheck(theme, 'home', 1);
  assert.equal(a.iteration, 1);
  assert.equal(b.iteration, 2);
  assert.equal(JSON.parse(fs.readFileSync(a.input, 'utf8')).marker, 1);
  assert.ok(b.input.includes('iter-2'));
  assert.equal(JSON.parse(fs.readFileSync(b.input, 'utf8')).iterDir, path.dirname(b.input));
  assert.equal(loadState(theme).pages[0].sections[0].status, 'verifying');
});

test('cap budget restarts after a passing iteration (fail, fail, pass, fail with max=2)', () => {
  const theme = setup(2);
  const run = (v) => { const d = path.dirname(prepareCheck(theme, 'home', 1).input); return recordVerdict(theme, 'home', 1, writeV(d, v)); };
  assert.equal(run(verdict(false)).capReached, false);
  assert.equal(run(verdict(false)).capReached, true);
  assert.equal(run(verdict(true)).pass, true);
  assert.equal(run(verdict(false)).capReached, false);
  assert.equal(run(verdict(false)).capReached, true);
});

// ---- I2: the verdict is cross-checked against what check-section wrote ------------------------------------------
const prep = (theme) => path.dirname(prepareCheck(theme, 'home', 1).input);
const everdict = (re) => (e) => e.code === 'EVERDICT' && re.test(e.message);

test('recordVerdict: a missing result.json means check-section did not run (EVERDICT)', () => {
  const theme = setup();
  const dir = prep(theme);
  assert.throws(() => recordVerdict(theme, 'home', 1, writeV(dir, verdict(true), 'verdict.json', { result: false })), everdict(/check-section did not run/));
  assert.equal(loadState(theme).pages[0].sections[0].qa.length, 0);
});

test('recordVerdict: result.json for another anchor is rejected', () => {
  const theme = setup();
  const dir = prep(theme);
  const f = writeV(dir, verdict(true));
  writeResult(dir, { ...resultFor(verdict(true)), anchor: 'pb-s2' });
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/anchor/));
});

test('recordVerdict: a self-consistent passing verdict that contradicts result.json numbers is rejected', () => {
  const theme = setup();
  const dir = prep(theme);
  const f = writeV(dir, verdict(true));
  // check-section measured a failing desktop diff; the verdict claims a pass with made-up numbers
  writeResult(dir, resultFor(verdict(false)));
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/numericPass/));
  // same numericPass, different numbers
  const r = resultFor(verdict(true)); r.results[0].mismatch = 0.031;
  writeResult(dir, r);
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/desktop.*mismatch/));
  const h = resultFor(verdict(true)); h.results[0].heightDelta = 0.02;
  writeResult(dir, h);
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/desktop.*heightDelta/));
  const w = resultFor(verdict(true)); w.results[1].widthDelta = -24;
  writeResult(dir, w);
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/tablet.*widthDelta/));
  const n = resultFor(verdict(true)); n.results[2].numericPass = false;
  writeResult(dir, n);
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/mobile.*numericPass/));
  assert.equal(loadState(theme).pages[0].sections[0].qa.length, 0);
  // differences below 1e-9 are float noise and accepted
  const ok = resultFor(verdict(true)); ok.results[0].mismatch += 1e-12;
  writeResult(dir, ok);
  assert.equal(recordVerdict(theme, 'home', 1, f).pass, true);
});

test('recordVerdict: the verdict must cover exactly the input breakpoints', () => {
  const theme = setup();
  const dir = prep(theme);
  const v = verdict(true);
  v.breakpoints = v.breakpoints.filter((b) => b.name !== 'tablet');
  const f = writeV(dir, v);
  writeResult(dir, resultFor(v));
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/breakpoints/));
});

test('recordVerdict: only the newest prepared iteration can be recorded', () => {
  const theme = setup();
  const dir1 = prep(theme);
  const dir2 = prep(theme);
  assert.throws(() => recordVerdict(theme, 'home', 1, writeV(dir1, verdict(true))), everdict(/iteration 1.*newest.*2|newest prepared iteration is 2/));
  assert.equal(recordVerdict(theme, 'home', 1, writeV(dir2, verdict(true))).iteration, 2);
});

test('recordVerdict re-applies the pass rule with the thresholds from site.qa (tampered input thresholds)', () => {
  const theme = setup();
  updateState(theme, (s) => { s.site.qa.mismatchMax = 0.02; });
  const dir = prep(theme);
  // result.json says numericPass true at mismatch 0.03 (as if input.json carried a looser mismatchMax)
  assert.throws(() => recordVerdict(theme, 'home', 1, writeV(dir, verdict(true))), everdict(/mismatch 0\.03 > 0\.02/));
  const fm = resultFor(verdict(true)); fm.results[0].fullyMasked = true;
  updateState(theme, (s) => { s.site.qa.mismatchMax = 0.08; });
  const dir2 = prep(theme);
  const f = writeV(dir2, verdict(true));
  writeResult(dir2, fm);
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/fully masked/));
});

test('pb-header anchors build an input and record like any section', () => {
  const theme = setup();
  updateState(theme, (s) => { s.pages[0].sections[0].anchor = 'pb-header'; });
  const dir = prep(theme);
  assert.ok(dir.endsWith(path.join('home', 'pb-header', 'iter-1')));
  assert.equal(recordVerdict(theme, 'home', 1, writeV(dir, verdict(true, { anchor: 'pb-header' }))).pass, true);
});

// ---- I3: no stuck or regressed statuses ---------------------------------------------------------------------------
test('prepareCheck refuses planned and skipped sections and writes nothing (EINPUT)', () => {
  for (const status of ['planned', 'skipped']) {
    const theme = setup();
    updateState(theme, (s) => { s.pages[0].sections[0].status = status; });
    assert.throws(() => prepareCheck(theme, 'home', 1), (e) => e.code === 'EINPUT' && /build it first/.test(e.message), status);
    assert.equal(loadState(theme).pages[0].sections[0].status, status);
    assert.equal(fs.existsSync(path.join(theme, '.protoblocks', 'artifacts', 'home')), false);
  }
});

test('a pass on a section that was done before re-verification returns it to done, not animating', () => {
  const theme = setup();
  updateState(theme, (s) => { s.pages[0].sections[0].status = 'done'; });
  const run = (v) => recordVerdict(theme, 'home', 1, writeV(prep(theme), v));
  assert.equal(loadState(theme).pages[0].sections[0].status, 'done');
  assert.equal(run(verdict(false)).status, 'building');
  assert.equal(run(verdict(true)).status, 'done');
  const sec = loadState(theme).pages[0].sections[0];
  assert.equal(sec.status, 'done');
  assert.equal(sec.prevStatus, undefined, 'cleared after the pass');
  // a section verified for the first time still goes to animating
  const t2 = setup();
  assert.equal(recordVerdict(t2, 'home', 1, writeV(prep(t2), verdict(true))).status, 'animating');
  // an animating section re-verified stays animating
  assert.equal(recordVerdict(t2, 'home', 1, writeV(prep(t2), verdict(true))).status, 'animating');
});

test('capReached is stored on the qa records of that iteration so a resumed session sees it', () => {
  const theme = setup(2);
  const run = (v) => recordVerdict(theme, 'home', 1, writeV(prep(theme), v));
  run(verdict(false));
  assert.ok(loadState(theme).pages[0].sections[0].qa.every((q) => q.capReached === undefined));
  assert.equal(run(verdict(false)).capReached, true);
  const qa = loadState(theme).pages[0].sections[0].qa;
  assert.ok(qa.filter((q) => q.iteration === 2).every((q) => q.capReached === true));
  assert.equal(qa.at(-1).capReached, true);
});

// ---- residuals ----------------------------------------------------------------------------------------------------
test('recording the same iteration twice is refused: a done section stays done, no duplicate qa entries', () => {
  const theme = setup();
  updateState(theme, (s) => { s.pages[0].sections[0].status = 'done'; });
  const dir = prep(theme);
  const f = writeV(dir, verdict(true));
  assert.equal(recordVerdict(theme, 'home', 1, f).status, 'done');
  const before = loadState(theme).pages[0].sections[0].qa.length;
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/already recorded/));
  const sec = loadState(theme).pages[0].sections[0];
  assert.equal(sec.status, 'done');
  assert.equal(sec.qa.length, before);
  // a failing verdict for an already-recorded iteration is refused too
  assert.throws(() => recordVerdict(theme, 'home', 1, writeV(dir, verdict(false), 'v2.json')), everdict(/already recorded/));
});

test('null mismatch/heightDelta/widthDelta are treated like absent fields', () => {
  const theme = setup();
  const dir = prep(theme);
  const v = verdict(true);
  v.breakpoints[1] = { ...v.breakpoints[1], mismatch: null, heightDelta: null, widthDelta: null };
  const r = resultFor(verdict(true));
  delete r.results[1].mismatch; delete r.results[1].heightDelta; // absent in result, null in verdict
  r.results[2].mismatch = null; r.results[2].heightDelta = null; // null in result, absent in verdict
  delete v.breakpoints[2].mismatch; delete v.breakpoints[2].heightDelta;
  const f = writeV(dir, v);
  writeResult(dir, r);
  assert.equal(recordVerdict(theme, 'home', 1, f).pass, true);
});

test('a passing diff breakpoint needs numeric mismatch and heightDelta (null is not 0)', () => {
  const theme = setup();
  const dir = prep(theme);
  const v = verdict(true);
  v.breakpoints[0] = { ...v.breakpoints[0], mismatch: null, heightDelta: null };
  const f = writeV(dir, v); // result.json carries the same nulls
  assert.throws(() => recordVerdict(theme, 'home', 1, f), everdict(/desktop has mismatch null/));
});
