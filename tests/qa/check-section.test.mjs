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
    // design identical to the render so only the image error can fail the diff
    const design = (await shoot({ url, selector: '#pb-s1', width: 1000, imageWaitMs: 1500, out: path.join(d, 'design.png') })).out;
    const r = await checkSection({ url, anchor: 'pb-s1', iterDir: path.join(d, 'i'), qa: QA, imageWaitMs: 1500,
      breakpoints: [{ name: 'desktop', width: 1000, design }] });
    assert.ok(r.results[0].imageErrors.length > 0, JSON.stringify(r.results[0]));
    assert.ok(r.results[0].mismatch <= QA.mismatchMax);
    assert.equal(r.results[0].numericPass, false);
    assert.equal(r.numericPass, false);

    const sOnly = await checkSection({ url, anchor: 'pb-s1', iterDir: path.join(d, 'j'), qa: QA, imageWaitMs: 1500,
      breakpoints: [{ name: 'tablet', width: 834, sanityOnly: true }] });
    assert.ok(sOnly.results[0].imageErrors.length > 0);
    assert.equal(sOnly.numericPass, false, 'sanity breakpoint image errors must flip overall numericPass');
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
