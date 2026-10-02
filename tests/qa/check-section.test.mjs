import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { qtest, tmpDir, serveFixtures, makeImage, QA_DIR } from './helpers.mjs';

const QA = { mismatchMax: 0.08, heightDeltaMax: 0.03 };
const load = () => import(path.join(QA_DIR, 'check-section.mjs'));

qtest('checkSection passes a matching design, fails a different one, and reports a missing anchor', async () => {
  const { checkSection } = await load();
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const good = (await shoot({ url, selector: '#pb-s1', width: 1440, out: path.join(d, 'design-good.png') })).out;
    const bad = await makeImage({ width: 1440, height: 520, bg: [255, 255, 255] }, path.join(d, 'design-bad.png'));

    const pass = await checkSection({ url, anchor: 'pb-s1', iterDir: path.join(d, 'i1'), qa: QA,
      breakpoints: [{ name: 'desktop', width: 1440, scale: 1, design: good }, { name: 'mobile', width: 390, sanityOnly: true }] });
    assert.equal(pass.numericPass, true, JSON.stringify(pass, null, 2));
    assert.ok(fs.existsSync(pass.results[0].composite));
    assert.ok(fs.existsSync(path.join(d, 'i1', 'result.json')));
    assert.equal(pass.results[1].mode, 'sanity');
    assert.deepEqual(pass.results[0].imageErrors, []);
    assert.deepEqual(pass.results[1].imageErrors, []);

    const fail = await checkSection({ url, anchor: 'pb-s1', iterDir: path.join(d, 'i2'), qa: QA,
      breakpoints: [{ name: 'desktop', width: 1440, scale: 1, design: bad }] });
    assert.equal(fail.numericPass, false);
    assert.ok(fail.results[0].heightDelta > 0.03);

    const missing = await checkSection({ url, anchor: 'pb-s9', iterDir: path.join(d, 'i3'), qa: QA,
      breakpoints: [{ name: 'desktop', width: 1440, scale: 1, design: good }] });
    assert.equal(missing.numericPass, false);
    assert.equal(missing.results[0].mode, 'error');
    assert.match(missing.results[0].error, /ENOSELECTOR/);
  } finally { await srv.close(); }
});

qtest('checkSection fails on image errors in diff and sanity modes', { timeout: 60000 }, async () => {
  const { checkSection } = await load();
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/hang.html`;
    // design identical to the render so only the (in-anchor) image error can fail the diff
    const design = (await shoot({ url, selector: '#pb-hang', width: 1000, imageWaitMs: 1500, out: path.join(d, 'design.png') })).out;
    const r = await checkSection({ url, anchor: 'pb-hang', iterDir: path.join(d, 'i'), qa: QA, imageWaitMs: 1500,
      breakpoints: [{ name: 'desktop', width: 1000, design }] });
    assert.ok(r.results[0].imageErrors.length > 0, JSON.stringify(r.results[0]));
    assert.ok(r.results[0].mismatch <= QA.mismatchMax);
    assert.equal(r.results[0].numericPass, false);
    assert.equal(r.numericPass, false);

    const sOnly = await checkSection({ url, anchor: 'pb-hang', iterDir: path.join(d, 'j'), qa: QA, imageWaitMs: 1500,
      breakpoints: [{ name: 'tablet', width: 834, sanityOnly: true }] });
    assert.ok(sOnly.results[0].imageErrors.length > 0);
    assert.equal(sOnly.numericPass, false, 'sanity breakpoint image errors must flip overall numericPass');
  } finally { await srv.close(); }
});

qtest('checkSection does not fail on a stalled image outside the anchor and reports it in pageImageWarnings', { timeout: 60000 }, async () => {
  const { checkSection } = await load();
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/hang.html`;
    const design = (await shoot({ url, selector: '#pb-s1', width: 1000, imageWaitMs: 1500, out: path.join(d, 'design.png') })).out;
    const r = await checkSection({ url, anchor: 'pb-s1', iterDir: path.join(d, 'i'), qa: QA, imageWaitMs: 1500,
      breakpoints: [{ name: 'desktop', width: 1000, design }, { name: 'mobile', width: 390, sanityOnly: true }] });
    for (const res of r.results) {
      assert.deepEqual(res.imageErrors, [], JSON.stringify(res));
      assert.equal(res.pageImageWarnings.length, 1, JSON.stringify(res));
      assert.match(res.pageImageWarnings[0], /__hang/);
      assert.equal(res.numericPass, true, JSON.stringify(res));
    }
    assert.equal(r.numericPass, true);
  } finally { await srv.close(); }
});

qtest('checkSection does not fail or stall on lazy images hidden inside the anchor', { timeout: 60000 }, async () => {
  const { checkSection } = await load();
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/hidden-lazy.html`;
    const design = (await shoot({ url, selector: '#pb-none', width: 1024, out: path.join(d, 'design.png') })).out;
    const imageWaitMs = 15000;
    const t = Date.now();
    const r = await checkSection({ url, anchor: 'pb-none', iterDir: path.join(d, 'i'), qa: QA, imageWaitMs,
      breakpoints: [{ name: 'desktop', width: 1024, design }] });
    const ms = Date.now() - t;
    assert.deepEqual(r.results[0].imageErrors, [], JSON.stringify(r.results[0]));
    assert.equal(r.numericPass, true, JSON.stringify(r.results[0]));
    assert.ok(ms < imageWaitMs / 2, `took ${ms}ms (imageWaitMs ${imageWaitMs})`);
  } finally { await srv.close(); }
});

qtest('checkSection fails a section narrower than the breakpoint with widthDelta instead of silently rescaling it', async () => {
  const { checkSection } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    // 1200x400 solid section; once rescaled to 1440 it is 1440x480 and would match this design pixel-for-pixel
    const design = await makeImage({ width: 1440, height: 480, bg: [30, 58, 138] }, path.join(d, 'design.png'));
    const r = await checkSection({ url: `${srv.url}/narrow.html`, anchor: 'pb-narrow', iterDir: path.join(d, 'i'), qa: QA,
      breakpoints: [{ name: 'desktop', width: 1440, design }] });
    const res = r.results[0];
    assert.equal(res.mode, 'diff');
    assert.equal(res.mismatch, 0, 'pixels alone would pass');
    assert.equal(res.heightDelta, 0);
    assert.equal(res.widthDelta, -240);
    assert.equal(res.numericPass, false);
    assert.equal(r.numericPass, false);

    const full = await checkSection({ url: `${srv.url}/narrow.html`, anchor: 'pb-narrow', iterDir: path.join(d, 'j'), qa: QA,
      breakpoints: [{ name: 'desktop', width: 1200, design }, { name: 'mobile', width: 390, sanityOnly: true }] });
    assert.equal(full.results[0].widthDelta, 0, 'section spans the 1200 breakpoint');
    assert.equal(full.results[1].widthDelta, 810, 'fixed 1200px section overflows a 390 viewport');
    assert.equal(full.results[1].numericPass, false);
  } finally { await srv.close(); }
});

qtest('checkSection error results keep page errors, console errors and HTTP status captured before the throw', async () => {
  const { checkSection } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const r = await checkSection({ url: `${srv.url}/throws.html`, anchor: 'pb-s9', iterDir: path.join(d, 'i'), qa: QA,
      breakpoints: [{ name: 'm', width: 390, sanityOnly: true }] });
    const res = r.results[0];
    assert.equal(res.mode, 'error');
    assert.match(res.error, /ENOSELECTOR/);
    assert.equal(res.numericPass, false);
    assert.equal(res.pageErrors.length, 1, JSON.stringify(res));
    assert.match(res.pageErrors[0], /fixture-boom/);
    assert.ok(Array.isArray(res.consoleErrors));
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.error, /HTTP/);

    const nf = await checkSection({ url: `${srv.url}/no-such-page.html`, anchor: 'pb-s1', iterDir: path.join(d, 'j'), qa: QA,
      breakpoints: [{ name: 'm', width: 390, sanityOnly: true }] });
    assert.equal(nf.results[0].status, 404);
    assert.match(nf.results[0].error, /ENOSELECTOR.*HTTP 404/);
  } finally { await srv.close(); }
});

qtest('checkSection reports the HTTP status on diff and sanity results', async () => {
  const { checkSection } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const design = await makeImage({ width: 1440, height: 400, bg: [30, 58, 138] }, path.join(d, 'design.png'));
    const r = await checkSection({ url: `${srv.url}/section.html`, anchor: 'pb-s1', iterDir: path.join(d, 'i'), qa: QA,
      breakpoints: [{ name: 'desktop', width: 1440, design }, { name: 'mobile', width: 390, sanityOnly: true }] });
    assert.deepEqual(r.results.map((x) => x.status), [200, 200]);
    assert.deepEqual(r.results.map((x) => typeof x.numericPass), ['boolean', 'boolean']);
  } finally { await srv.close(); }
});

qtest('checkSection resolves a relative iterDir', async () => {
  const { checkSection } = await load();
  const srv = await serveFixtures();
  try {
    const rel = path.relative(process.cwd(), path.join(tmpDir(), 'i'));
    assert.ok(!path.isAbsolute(rel));
    const r = await checkSection({ url: `${srv.url}/section.html`, anchor: 'pb-s1', iterDir: rel, qa: QA, breakpoints: [{ name: 'm', width: 390, sanityOnly: true }] });
    assert.ok(path.isAbsolute(r.results[0].render), r.results[0].render);
    assert.equal(r.results[0].render, path.resolve(rel, 'm-render.png'));
    assert.ok(fs.existsSync(path.resolve(rel, 'result.json')));
  } finally { await srv.close(); }
});

qtest('checkSection fails a fully masked diff', async () => {
  const { checkSection } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const design = await makeImage({ width: 1440, height: 400, bg: [255, 255, 255] }, path.join(d, 'design.png'));
    const r = await checkSection({ url: `${srv.url}/section.html`, anchor: 'pb-s1', iterDir: path.join(d, 'i'), qa: QA,
      breakpoints: [{ name: 'desktop', width: 1440, design, masks: [{ x: 0, y: 0, w: 1440, h: 400 }] }] });
    assert.equal(r.results[0].mode, 'diff');
    assert.equal(r.results[0].numericPass, false);
    assert.equal(r.numericPass, false);
  } finally { await srv.close(); }
});

qtest('checkSection rejects bad anchors with EANCHOR before launching a browser', async () => {
  const { checkSection } = await load();
  const d = tmpDir();
  for (const anchor of ['', '1abc', 'a b', 'a.b', 'a"]', undefined, 'x>y']) {
    await assert.rejects(
      () => checkSection({ url: 'http://127.0.0.1:1/', anchor, iterDir: path.join(d, 'i'), qa: QA, breakpoints: [{ name: 'm', width: 390, sanityOnly: true }] }),
      (e) => e.code === 'EANCHOR', `anchor ${JSON.stringify(anchor)}`);
  }
  assert.ok(!fs.existsSync(path.join(d, 'i')), 'no output dir created on invalid input');
});

qtest('checkSection rejects bad input with EINPUT before launching a browser', async () => {
  const { checkSection } = await load();
  const d = tmpDir();
  const design = await makeImage({ width: 10, height: 10 }, path.join(d, 'x.png'));
  const base = { url: 'http://127.0.0.1:1/', anchor: 'pb-s1', iterDir: path.join(d, 'i'), qa: QA };
  const bp = { name: 'm', width: 390, sanityOnly: true };
  const cases = {
    'breakpoints missing': { ...base },
    'breakpoints empty': { ...base, breakpoints: [] },
    'breakpoints not array': { ...base, breakpoints: {} },
    'no name': { ...base, breakpoints: [{ width: 390, sanityOnly: true }] },
    'zero width': { ...base, breakpoints: [{ ...bp, width: 0 }] },
    'negative width': { ...base, breakpoints: [{ ...bp, width: -5 }] },
    'non-numeric width': { ...base, breakpoints: [{ ...bp, width: '390' }] },
    'duplicate names': { ...base, breakpoints: [bp, { ...bp, width: 800 }] },
    'unsafe name': { ...base, breakpoints: [{ ...bp, name: '../evil' }] },
    'design missing on disk': { ...base, breakpoints: [{ name: 'd', width: 1440, design: path.join(d, 'nope.png') }] },
    'qa missing': { ...base, qa: undefined, breakpoints: [bp] },
    'mismatchMax not number': { ...base, qa: { mismatchMax: '0.1', heightDeltaMax: 0.03 }, breakpoints: [bp] },
    'heightDeltaMax missing': { ...base, qa: { mismatchMax: 0.1 }, breakpoints: [bp] },
    'iterDir missing': { ...base, iterDir: undefined, breakpoints: [bp] },
    'iterDir empty': { ...base, iterDir: '', breakpoints: [bp] },
    'iterDir not string': { ...base, iterDir: 42, breakpoints: [bp] },
    'url missing': { ...base, url: undefined, breakpoints: [bp] },
    'url not a URL': { ...base, url: 'localhost/page', breakpoints: [bp] },
    'url not http(s)': { ...base, url: 'file:///etc/passwd', breakpoints: [bp] },
    'scale zero': { ...base, breakpoints: [{ ...bp, scale: 0 }] },
    'scale negative': { ...base, breakpoints: [{ ...bp, scale: -2 }] },
    'scale not number': { ...base, breakpoints: [{ ...bp, scale: '2' }] },
    'masks not array': { ...base, breakpoints: [{ name: 'd', width: 1440, design, masks: { x: 0, y: 0, w: 1, h: 1 } }] },
  };
  for (const [name, input] of Object.entries(cases)) {
    await assert.rejects(() => checkSection(input), (e) => e.code === 'EINPUT' && e.message.length > 10, name);
  }
  // sanity: a valid input with a real design file is not rejected by validation (fails later on the unreachable url instead)
  await assert.rejects(
    () => checkSection({ ...base, breakpoints: [{ name: 'd', width: 100, design }] }).then((r) => { if (r.results[0].mode !== 'error') throw new Error('expected error result'); throw Object.assign(new Error('ok'), { code: 'OK' }); }),
    (e) => e.code === 'OK');
});

qtest('check-section CLI: usage, missing file and bad JSON exit cleanly', () => {
  const cli = path.join(QA_DIR, 'check-section.mjs');
  const d = tmpDir();
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const none = run();
  assert.equal(none.status, 64);
  assert.match(none.stderr, /Usage/);
  const missing = run(path.join(d, 'nope.json'));
  assert.equal(missing.status, 1);
  assert.doesNotMatch(missing.stderr, /\n\s+at /);
  assert.equal(missing.stderr.trim().split('\n').length, 1);
  assert.match(missing.stderr, /nope\.json/);
  fs.writeFileSync(path.join(d, 'bad.json'), '{not json');
  const bad = run(path.join(d, 'bad.json'));
  assert.equal(bad.status, 1);
  assert.doesNotMatch(bad.stderr, /\n\s+at /);
  assert.equal(bad.stderr.trim().split('\n').length, 1);
  assert.match(bad.stderr, /bad\.json/);
  fs.writeFileSync(path.join(d, 'inv.json'), JSON.stringify({ url: 'x', anchor: '1', iterDir: d, qa: QA, breakpoints: [] }));
  const inv = run(path.join(d, 'inv.json'));
  assert.equal(inv.status, 1);
  assert.match(inv.stderr, /EANCHOR|anchor/i);
});

qtest('checkSection fails on a 404 image inside the anchor and ignores one outside it', async () => {
  const { checkSection } = await load();
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/imgs.html`;
    const design = (await shoot({ url, selector: '#pb-s1', width: 600, out: path.join(d, 'design.png') })).out;
    const r = await checkSection({ url, anchor: 'pb-s1', iterDir: path.join(d, 'i'), qa: QA, breakpoints: [{ name: 'desktop', width: 600, design }] });
    assert.equal(r.results[0].imageErrors.length, 1, JSON.stringify(r.results[0].imageErrors));
    assert.match(r.results[0].imageErrors[0], /missing-inside/);
    assert.ok(r.results[0].imageErrors.every((u) => typeof u === 'string'));
    assert.equal(r.results[0].numericPass, false);
    assert.equal(r.numericPass, false);

    const s3 = await checkSection({ url, anchor: 'pb-s3', iterDir: path.join(d, 'k'), qa: QA, breakpoints: [{ name: 'm', width: 600, sanityOnly: true }] });
    assert.deepEqual(s3.results[0].imageErrors, [], 'working images and src-less images are not errors');

    const self = await shoot({ url, selector: '#pb-img', width: 600, out: path.join(d, 'self.png') });
    assert.equal(self.imageErrors.length, 1);
    assert.match(self.imageErrors[0], /missing-self/);
  } finally { await srv.close(); }
});

qtest('checkSection rejects null and non-object input with EINPUT', async () => {
  const { checkSection } = await load();
  for (const input of [null, undefined, 'x', 42, []]) {
    await assert.rejects(() => checkSection(input), (e) => e.code === 'EINPUT', String(input));
  }
});
