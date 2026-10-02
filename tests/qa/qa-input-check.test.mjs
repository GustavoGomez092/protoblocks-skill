import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, makeImage } from './helpers.mjs';

const LIB = '../../skills/protoblocks-site-builder/scripts/lib';

qtest('buildCheckInput/prepareCheck output is accepted by the real check-section validation', async () => {
  const { prepareCheck } = await import(`${LIB}/qa-input.mjs`);
  const { initState, updateState } = await import(`${LIB}/state.mjs`);
  const { checkSection } = await import('../../skills/protoblocks-site-builder/scripts/qa/check-section.mjs');
  const srv = await serveFixtures();
  try {
    const theme = tmpDir();
    initState(theme, { url: srv.url, path: '/x' });
    const crop = await makeImage({ width: 1440, height: 400 }, path.join(theme, 'crop.png'));
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', url: `${srv.url}/section.html`,
        design: { frames: [{ breakpoint: 'desktop', width: 1440, scale: 1, image: crop }] },
        sections: [{ n: 1, anchor: 'pb-s1', block: 'hero', status: 'building', crops: { desktop: crop }, qa: [] }] });
    });
    const { input } = prepareCheck(theme, 'fx', 1);
    const res = await checkSection(JSON.parse((await import('node:fs')).readFileSync(input, 'utf8')));
    // validate() throws EINPUT/EANCHOR before any work; reaching results proves the input shape is accepted
    assert.ok(Array.isArray(res.results));
    assert.deepEqual(res.results.map((r) => r.breakpoint), ['desktop', 'tablet', 'mobile']);
    assert.equal(res.results[0].mode, 'diff');
    assert.ok(res.results.every((r) => r.mode !== 'error'), JSON.stringify(res.results.filter((r) => r.mode === 'error')));
  } finally { await srv.close(); }
});

qtest('recordVerdict accepts a verdict copied from the real result.json and rejects one with edited numbers', async () => {
  const fs = await import('node:fs');
  const { prepareCheck, recordVerdict } = await import(`${LIB}/qa-input.mjs`);
  const { initState, updateState } = await import(`${LIB}/state.mjs`);
  const { checkSection } = await import('../../skills/protoblocks-site-builder/scripts/qa/check-section.mjs');
  const srv = await serveFixtures();
  try {
    const theme = tmpDir();
    initState(theme, { url: srv.url, path: '/x' });
    const crop = await makeImage({ width: 1440, height: 400 }, path.join(theme, 'crop.png'));
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', url: `${srv.url}/section.html`,
        design: { frames: [{ breakpoint: 'desktop', width: 1440, scale: 1, image: crop }] },
        sections: [{ n: 1, anchor: 'pb-s1', block: 'hero', status: 'building', crops: { desktop: crop }, qa: [] }] });
    });
    const { input } = prepareCheck(theme, 'fx', 1);
    const res = await checkSection(JSON.parse(fs.readFileSync(input, 'utf8')));
    const iterDir = path.dirname(input);
    const v = { pass: false, anchor: res.anchor, numericPass: res.numericPass, discrepancies: [{ breakpoint: 'desktop', area: 'all', issue: 'x', severity: 'high', fix: 'y' }],
      breakpoints: res.results.map((r) => ({ name: r.breakpoint, mode: r.mode, mismatch: r.mismatch, heightDelta: r.heightDelta, widthDelta: r.widthDelta, numericPass: r.numericPass })) };
    const forged = structuredClone(v);
    forged.breakpoints[0].mismatch = (forged.breakpoints[0].mismatch ?? 0) + 0.5;
    fs.writeFileSync(path.join(iterDir, 'forged.json'), JSON.stringify(forged));
    assert.throws(() => recordVerdict(theme, 'fx', 1, path.join(iterDir, 'forged.json')), (e) => e.code === 'EVERDICT' && /mismatch/.test(e.message));
    fs.writeFileSync(path.join(iterDir, 'verdict.json'), JSON.stringify(v));
    const r = recordVerdict(theme, 'fx', 1, path.join(iterDir, 'verdict.json'));
    assert.equal(r.iteration, 1);
    assert.equal(r.pass, false);
  } finally { await srv.close(); }
});
