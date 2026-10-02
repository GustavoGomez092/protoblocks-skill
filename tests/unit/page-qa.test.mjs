import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filterViolations, fitScale, pageQa, recordPageQa, buildInputs } from '../../skills/protoblocks-site-builder/scripts/qa/page-qa.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

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

test('recordPageQa stores the absolute file; pass moves the page to seo, fail leaves status', async () => {
  const dir = stateWith([{ slug: 'home', status: 'building', sections: [] }]);
  const f = path.join(dir, 'pq.json');
  fs.writeFileSync(f, JSON.stringify({ pass: false }));
  assert.deepEqual(await recordPageQa(dir, 'home', f), { pass: false, status: 'building' });
  fs.writeFileSync(f, JSON.stringify({ pass: true }));
  const rel = path.relative(process.cwd(), f);
  assert.deepEqual(await recordPageQa(dir, 'home', rel), { pass: true, status: 'seo' });
  const p = loadState(dir).pages[0];
  assert.equal(p.status, 'seo');
  assert.equal(p.pageQa.file, f);
  assert.equal(p.pageQa.pass, true);
  assert.ok(p.pageQa.at);
});

test('recordPageQa: missing page is ENOPAGE; unreadable or unparseable file is EINPUT; state untouched', async () => {
  const dir = stateWith([{ slug: 'home', status: 'building', sections: [] }]);
  const f = path.join(dir, 'pq.json');
  fs.writeFileSync(f, JSON.stringify({ pass: true }));
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
