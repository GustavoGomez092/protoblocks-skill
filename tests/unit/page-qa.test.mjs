import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { filterViolations, fitScale, pageQa, recordPageQa, buildInputs, acceptBlockers, sectionMasksFor, renderMasks } from '../../skills/protoblocks-site-builder/scripts/qa/page-qa.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const SCRIPT = new URL('../../skills/protoblocks-site-builder/scripts/qa/page-qa.mjs', import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pageqa-unit-'));
const rejectsCode = (p, code) => assert.rejects(p, (e) => e.code === code);

test('filterViolations keeps page-content nodes and splits by impact', () => {
  const v = [
    { id: 'color-contrast', impact: 'serious', nodes: [{ target: ['main #pb-s2 p'] }, { target: ['#wpadminbar a'] }] },
    { id: 'region', impact: 'moderate', nodes: [{ target: ['footer .x'] }] },
    { id: 'link-name', impact: 'critical', nodes: [{ target: ['#third-party-widget a'] }] },
  ];
  const r = filterViolations(v);
  assert.deepEqual(r.blocking.map((x) => [x.id, x.nodes.length]), [['color-contrast', 1]]);
  assert.deepEqual(r.other.map((x) => x.id), ['region']);
});

test('filterViolations does not match scope words inside other names (domain, mainnav, footer-widget)', () => {
  const v = [{ id: 'x', impact: 'critical', nodes: [{ target: ['.domain a'] }, { target: ['.mainnav a'] }, { target: ['#footer-widget a'] }, { target: ['.site-header a'] }] }];
  assert.deepEqual(filterViolations(v), { blocking: [], other: [] });
});

test('filterViolations keeps tag scopes with classes, header/#pb-s anchors, nested (iframe) targets; null impact is not blocking', () => {
  const v = [
    { id: 'a', impact: 'serious', nodes: [{ target: ['header.site-header a'] }] },
    { id: 'b', impact: 'critical', nodes: [{ target: [['iframe', '#pb-s4 button']] }] },
    { id: 'c', impact: null, nodes: [{ target: ['main > p'] }] },
    { id: 'd', impact: 'critical', nodes: [{}] },
  ];
  const r = filterViolations(v);
  assert.deepEqual(r.blocking.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(r.other.map((x) => x.id), ['c']);
});

test('fitScale keeps scale when the surface fits, lowers it to an integer, and warns when scale 1 is too tall', () => {
  assert.deepEqual(fitScale(5000, 2), { scaleUsed: 2, warning: null });
  assert.deepEqual(fitScale(5000, 4), { scaleUsed: 3, warning: null });
  assert.deepEqual(fitScale(9000, 2), { scaleUsed: 1, warning: null });
  assert.equal(fitScale(20000, 2).scaleUsed, 1);
  assert.match(fitScale(20000, 2).warning, /16000/);
  assert.deepEqual(fitScale(16000, 1), { scaleUsed: 1, warning: null });
});

test('pageQa rejects empty or malformed input with EINPUT before touching a browser', async () => {
  const d = tmp();
  const png = path.join(d, 'a.png');
  fs.writeFileSync(png, 'x');
  const good = { breakpoint: 'desktop', width: 1440, scale: 1, image: png };
  const base = { url: 'http://x.local/', frames: [good], outDir: path.join(d, 'out') };
  await rejectsCode(pageQa({ ...base, frames: [] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: undefined }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: [{ ...good, breakpoint: '../evil' }] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: [{ ...good, breakpoint: '' }] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: [{ ...good, width: 0 }] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: [{ ...good, width: '1440' }] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: [{ ...good, scale: 0 }] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: [{ ...good, image: path.join(d, 'missing.png') }] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: [{ ...good, image: d }] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, frames: [good, good] }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, outDir: '' }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, outDir: undefined }), 'EINPUT');
  await rejectsCode(pageQa({ ...base, url: '' }), 'EINPUT');
  assert.equal(fs.existsSync(path.join(d, 'out')), false);
});

function stateWith(pages, site = { url: 'http://a.local', path: '/x' }) {
  const dir = tmp();
  initState(dir, site);
  updateState(dir, (s) => { s.pages = pages; });
  return dir;
}

const URL_ = 'http://a.local/home/';
test('recordPageQa stores the absolute file; pass moves the page to seo, fail leaves status', async () => {
  const dir = stateWith([{ slug: 'home', url: URL_, status: 'building', sections: [] }]);
  const f = path.join(dir, 'pq.json');
  fs.writeFileSync(f, JSON.stringify({ url: URL_, pass: false }));
  assert.deepEqual(await recordPageQa(dir, 'home', f), { pass: false, status: 'building' });
  fs.writeFileSync(f, JSON.stringify({ url: URL_, pass: true }));
  const rel = path.relative(process.cwd(), f);
  assert.deepEqual(await recordPageQa(dir, 'home', rel), { pass: true, status: 'seo' });
  const p = loadState(dir).pages[0];
  assert.equal(p.status, 'seo');
  assert.equal(p.pageQa.file, f);
  assert.equal(p.pageQa.pass, true);
  assert.ok(p.pageQa.at);
});

test('recordPageQa: missing page is ENOPAGE; unreadable or unparseable file is EINPUT; state untouched', async () => {
  const dir = stateWith([{ slug: 'home', url: URL_, status: 'building', sections: [] }]);
  const f = path.join(dir, 'pq.json');
  fs.writeFileSync(f, JSON.stringify({ url: URL_, pass: true }));
  await rejectsCode(recordPageQa(dir, 'nope', f), 'ENOPAGE');
  await rejectsCode(recordPageQa(dir, 'home', path.join(dir, 'absent.json')), 'EINPUT');
  fs.writeFileSync(f, '{not json');
  await rejectsCode(recordPageQa(dir, 'home', f), 'EINPUT');
  fs.writeFileSync(f, 'null');
  await rejectsCode(recordPageQa(dir, 'home', f), 'EINPUT');
  assert.equal(loadState(dir).pages[0].pageQa, undefined);
});

test('buildInputs maps design frames, qa overrides and the artifacts outDir; no url is ENOPAGE', () => {
  const frames = [{ breakpoint: 'desktop', width: 1440, scale: 2, image: '/abs/d.png' }, { breakpoint: 'mobile', width: 390, image: 'artifacts/home/m.png', extra: 1 }];
  const dir = stateWith(
    [{ slug: 'home', url: 'http://a.local/home/', status: 'building', sections: [], design: { source: 'image', ref: 'r', frames } }, { slug: 'nourl', status: 'building', sections: [] }],
    { url: 'http://a.local', path: '/x', qa: { pageMismatchMax: 0.2 } },
  );
  const r = buildInputs(dir, 'home');
  assert.equal(r.url, 'http://a.local/home/');
  assert.equal(r.qa.pageMismatchMax, 0.2);
  assert.equal(r.outDir, path.join(dir, '.protoblocks', 'artifacts', 'home', 'page-qa'));
  assert.deepEqual(r.frames[0], { breakpoint: 'desktop', width: 1440, scale: 2, image: '/abs/d.png' });
  assert.deepEqual(r.frames[1], { breakpoint: 'mobile', width: 390, scale: 1, image: path.join(dir, '.protoblocks', 'artifacts', 'home', 'm.png') });
  assert.deepEqual(r.warnings, []);
  assert.throws(() => buildInputs(dir, 'nourl'), (e) => e.code === 'ENOPAGE');
  assert.throws(() => buildInputs(dir, 'ghost'), (e) => e.code === 'ENOPAGE');
});

test('filterViolations trusts a DOM-resolved inScope flag over the target string (axe targets are shortest-unique, e.g. "img")', () => {
  const v = [{ id: 'image-alt', impact: 'critical', nodes: [{ target: ['img'], inScope: true }, { target: ['main img'], inScope: false }, { target: ['img:nth-child(2)'], inScope: false }] }];
  const r = filterViolations(v);
  assert.deepEqual(r.blocking.map((x) => [x.id, x.nodes.length]), [['image-alt', 1]]);
  assert.deepEqual(r.blocking[0].nodes[0].target, ['img']);
});

test('filterViolations counts document-level nodes (html, body) but not look-alike selectors', () => {
  const v = [
    { id: 'html-has-lang', impact: 'serious', nodes: [{ target: ['html'] }] },
    { id: 'bypass', impact: 'moderate', nodes: [{ target: ['body'] }] },
    { id: 'x', impact: 'critical', nodes: [{ target: ['html > div'] }, { target: ['body.home .widget'] }] },
    { id: 'flagged', impact: 'critical', nodes: [{ target: ['html'], inScope: true }] },
  ];
  const r = filterViolations(v);
  assert.deepEqual(r.blocking.map((x) => x.id), ['html-has-lang', 'flagged']);
  assert.deepEqual(r.other.map((x) => x.id), ['bypass']);
});

test('initState fills site.qa.pageMismatchMax (0.12) and keeps an explicit value', () => {
  const a = tmp();
  assert.equal(initState(a, { url: 'http://a.local', path: '/x' }).site.qa.pageMismatchMax, 0.12);
  const b = tmp();
  assert.equal(initState(b, { url: 'http://a.local', path: '/x', qa: { pageMismatchMax: 0.2 } }).site.qa.pageMismatchMax, 0.2);
});

// ---- record guards and developer acceptance ----
const designFail = (extra = {}) => ({
  url: URL_, pass: false, a11y: { blocking: [], other: [{ id: 'region', impact: 'moderate' }] }, pageErrors: [], warnings: [],
  breakpoints: [{ name: 'desktop', status: 200, mismatch: 0.2, heightDelta: 0.01, fullyMasked: false, imageErrors: [], pass: false }],
  ...extra,
});
const qaPage = (extra = {}) => ({ slug: 'home', url: URL_, status: 'building', design: { frames: [{ breakpoint: 'desktop', width: 1440, image: 'd.png' }] }, sections: [{ n: 1, anchor: 'pb-s1', status: 'done' }, { n: 2, anchor: 'pb-s2', status: 'skipped' }], ...extra });
const writeResult = (dir, obj) => { const f = path.join(dir, `pq-${Math.random().toString(16).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

test('recordPageQa guards: page must be building, every section done/skipped, and the result of the page url', async () => {
  for (const st of ['planning', 'seo', 'done']) {
    const dir = stateWith([qaPage({ status: st })]);
    await rejectsCode(recordPageQa(dir, 'home', writeResult(dir, { url: URL_, pass: true })), 'ESTATUS');
  }
  for (const st of ['planned', 'building', 'verifying', 'animating']) {
    const dir = stateWith([qaPage({ sections: [{ n: 1, anchor: 'pb-s1', status: 'done' }, { n: 2, anchor: 'pb-s2', status: st }] })]);
    await assert.rejects(recordPageQa(dir, 'home', writeResult(dir, { url: URL_, pass: true })), (e) => e.code === 'ESTATUS' && /2: /.test(e.message), st);
  }
  const dir = stateWith([qaPage()]);
  await rejectsCode(recordPageQa(dir, 'home', writeResult(dir, { url: 'http://a.local/other/', pass: true })), 'EINPUT');
  await rejectsCode(recordPageQa(dir, 'home', writeResult(dir, { pass: true })), 'EINPUT');
  const nourl = stateWith([qaPage({ url: undefined })]);
  await rejectsCode(recordPageQa(nourl, 'home', writeResult(nourl, { url: URL_, pass: true })), 'EINPUT');
  assert.deepEqual([loadState(dir).pages[0].status, loadState(dir).pages[0].pageQa], ['building', undefined]);
});

test('recordPageQa --accepted: design-only failures are accepted with the note; status seo', async () => {
  const dir = stateWith([qaPage({ notes: { shellCap: 'x' } })]);
  const f = writeResult(dir, designFail());
  assert.deepEqual(await recordPageQa(dir, 'home', f, { accepted: '  hero photo is a placeholder  ' }), { pass: false, accepted: true, status: 'seo' });
  const p = loadState(dir).pages[0];
  assert.equal(p.status, 'seo');
  assert.deepEqual({ ...p.pageQa, at: undefined }, { pass: false, accepted: true, note: 'hero photo is a placeholder', by: 'developer', file: f, at: undefined });
  assert.deepEqual(p.notes, { shellCap: 'x', pageQa: 'accepted by developer: hero photo is a placeholder' });
});

test('recordPageQa --accepted: a real pass wins; an empty note is EINPUT; a later fail clears the acceptance', async () => {
  const dir = stateWith([qaPage()]);
  assert.deepEqual(await recordPageQa(dir, 'home', writeResult(dir, { url: URL_, pass: true }), { accepted: 'n' }), { pass: true, status: 'seo' });
  assert.equal(loadState(dir).pages[0].pageQa.accepted, undefined);
  for (const bad of ['', '   ', 5]) await rejectsCode(recordPageQa(dir, 'home', writeResult(dir, designFail()), { accepted: bad }), 'EINPUT');
  const d2 = stateWith([qaPage()]);
  await recordPageQa(d2, 'home', writeResult(d2, designFail()), { accepted: 'ok' });
  updateState(d2, (s) => { s.pages[0].status = 'building'; });
  assert.deepEqual(await recordPageQa(d2, 'home', writeResult(d2, designFail())), { pass: false, status: 'building' });
  assert.equal(loadState(d2).pages[0].pageQa.accepted, undefined);
});

test('recordPageQa --accepted refuses anything but design differences (EACCEPT) and changes nothing', async () => {
  const bp = (extra) => ({ breakpoints: [{ ...designFail().breakpoints[0], ...extra }] });
  const cases = {
    error: { error: 'browser crashed' },
    a11yError: { a11y: { blocking: [], other: [], error: 'axe missing' } },
    a11yBlocking: { a11y: { blocking: [{ id: 'image-alt', impact: 'critical' }], other: [] } },
    pageErrors: { pageErrors: ['boom'] },
    http: bp({ status: 404 }),
    fullyMasked: bp({ fullyMasked: true }),
    imageErrors: bp({ imageErrors: ['http://a.local/x.png'] }),
    missingBreakpoint: { breakpoints: [] },
    nothingFailed: bp({ pass: true }),
  };
  for (const [name, extra] of Object.entries(cases)) {
    const dir = stateWith([qaPage()]);
    await assert.rejects(recordPageQa(dir, 'home', writeResult(dir, designFail(extra)), { accepted: 'ok' }), (e) => e.code === 'EACCEPT', name);
    assert.deepEqual([loadState(dir).pages[0].status, loadState(dir).pages[0].pageQa], ['building', undefined], name);
  }
  assert.deepEqual(acceptBlockers(designFail(), [{ breakpoint: 'desktop' }]), []);
  assert.match(acceptBlockers(designFail(), [{ breakpoint: 'desktop' }, { breakpoint: 'mobile' }]).join(), /mobile was not checked/);
});

test('page-qa CLI record: strict flags; --accepted needs a note', () => {
  const dir = stateWith([qaPage()]);
  const f = writeResult(dir, designFail());
  const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
  assert.equal(run('record', dir, 'home', f, '--force').status, 64);
  assert.equal(run('record', dir, 'home').status, 64);
  assert.equal(run('record', dir, 'home', f, 'extra').status, 64);
  let r = run('record', dir, 'home', f, '--accepted');
  assert.deepEqual([r.status, /\[EINPUT\]/.test(r.stderr)], [1, true]);
  r = run('record', dir, 'home', f, '--accepted', '');
  assert.deepEqual([r.status, /\[EINPUT\]/.test(r.stderr)], [1, true]);
  r = run('record', dir, 'home', f, '--accepted', 'placeholder hero');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { pass: false, accepted: true, status: 'seo' });
});

// ---- section masks in page coordinates ----
test('sectionMasksFor translates crop masks with the crop range, clips to the section, and warns without a range', () => {
  const page = { sections: [
    { n: 3, anchor: 'pb-s3', status: 'done', ranges: { desktop: { y0: 1000, y1: 1400 } }, masks: { desktop: [{ x: 10, y: 20, w: 300, h: 100 }, { x: 0, y: 350, w: 50, h: 200 }, { x: 0, y: 400, w: 5, h: 5 }] } },
    { n: 1, anchor: 'pb-header', status: 'done', ranges: { desktop: { y0: 0, y1: 96 } }, masks: { desktop: [{ x: 0, y: 0, w: 100, h: 50 }], mobile: [{ x: 0, y: 0, w: 1, h: 1 }] } },
    { n: 4, anchor: 'pb-s4', status: 'done', masks: { desktop: [{ x: 0, y: 0, w: 1, h: 1 }] } },
    { n: 5, anchor: 'pb-s5', status: 'skipped', ranges: { desktop: { y0: 0, y1: 10 } }, masks: { desktop: [{ x: 0, y: 0, w: 1, h: 1 }] } },
  ] };
  const warnings = [];
  const r = sectionMasksFor(page, 'desktop', warnings);
  assert.deepEqual(r.masks, [{ x: 0, y: 0, w: 100, h: 50 }, { x: 10, y: 1020, w: 300, h: 100 }, { x: 0, y: 1350, w: 50, h: 50 }]);
  assert.deepEqual(r.sectionMasks, [{ anchor: 'pb-header', masks: [{ x: 0, y: 0, w: 100, h: 50 }] }, { anchor: 'pb-s3', masks: [{ x: 10, y: 20, w: 300, h: 100 }, { x: 0, y: 350, w: 50, h: 50 }] }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /section 4 \(#pb-s4\) has masks but no crop range/);
});

test('buildInputs passes masks, section masks and design px per CSS px per frame, plus the no-range warnings', () => {
  const frames = [{ breakpoint: 'desktop', width: 1440, scale: 2, pixelWidth: 2880, image: '/abs/d.png' }, { breakpoint: 'mobile', width: 390, scale: 2, image: '/abs/m.png' }];
  const dir = stateWith([{ slug: 'home', url: URL_, status: 'building', design: { frames }, sections: [
    { n: 2, anchor: 'pb-s2', status: 'done', ranges: { desktop: { y0: 200, y1: 900 } }, masks: { desktop: [{ x: 0, y: 10, w: 40, h: 40 }], mobile: [{ x: 0, y: 0, w: 4, h: 4 }] } },
  ] }]);
  const r = buildInputs(dir, 'home');
  assert.deepEqual(r.frames[0], { breakpoint: 'desktop', width: 1440, scale: 2, image: '/abs/d.png', masks: [{ x: 0, y: 210, w: 40, h: 40 }], sectionMasks: [{ anchor: 'pb-s2', masks: [{ x: 0, y: 10, w: 40, h: 40 }] }], pxPerCss: 2 });
  assert.deepEqual(r.frames[1], { breakpoint: 'mobile', width: 390, scale: 2, image: '/abs/m.png' });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^mobile: section 2/);
});

test('renderMasks places section masks at the measured anchor top (CSS px times design px per CSS px)', () => {
  const sm = [{ anchor: 'pb-s2', masks: [{ x: 5, y: 10, w: 40, h: 40 }] }, { anchor: 'pb-gone', masks: [{ x: 0, y: 0, w: 1, h: 1 }] }];
  assert.deepEqual(renderMasks(sm, { 'pb-s2': 1234.4, 'pb-gone': null }, 2), { masks: [{ x: 5, y: 2479, w: 40, h: 40 }], missing: ['pb-gone'] });
  assert.deepEqual(renderMasks(), { masks: [], missing: [] });
});
