import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

const px = (raw, x, y) => { const i = (y * raw.width + x) * 4; return [...raw.data.subarray(i, i + 3)]; };
const load = async () => ({
  ...(await import(path.join(QA_DIR, 'og-image.mjs'))),
  ...(await import(path.join(QA_DIR, 'image.mjs'))),
});

qtest('ogImage crops a tall section to exactly 1200x630, keeping the top', async () => {
  const { ogImage, loadRaw } = await load();
  const srv = await serveFixtures();
  try {
    const r = await ogImage({ url: `${srv.url}/og-tall.html`, selector: '#pb-s1', out: path.join(tmpDir(), 'tall.png') });
    assert.deepEqual([r.width, r.height, r.source.height], [1200, 630, 900]);
    const raw = await loadRaw(r.out);
    assert.deepEqual([raw.width, raw.height], [1200, 630]);
    assert.deepEqual(px(raw, 5, 10), [0xdc, 0x26, 0x26], 'top of the section is kept');
    assert.deepEqual(px(raw, 5, 85), [0xdc, 0x26, 0x26], 'cropped, not squashed (red band is 100px tall)');
    assert.deepEqual(px(raw, 5, 629), [0x16, 0xa3, 0x4a]);
  } finally { await srv.close(); }
});

qtest('ogImage pads a short section to exactly 1200x630 with its bottom-left colour', async () => {
  const { ogImage, loadRaw } = await load();
  const srv = await serveFixtures();
  try {
    const r = await ogImage({ url: `${srv.url}/og-short.html`, selector: '#pb-s1', out: path.join(tmpDir(), 'short.png') });
    assert.deepEqual([r.width, r.height, r.source.height], [1200, 630, 400]);
    const raw = await loadRaw(r.out);
    assert.deepEqual([raw.width, raw.height], [1200, 630]);
    assert.deepEqual(px(raw, 5, 299), [255, 255, 255], 'content kept at native scale');
    assert.deepEqual(px(raw, 5, 350), [0x1e, 0x3a, 0x8a], 'content not stretched');
    assert.deepEqual(px(raw, 5, 629), [0x1e, 0x3a, 0x8a], 'padding uses the bottom-left colour');
  } finally { await srv.close(); }
});

qtest('ogImage removes its temp dir even when shoot throws', async () => {
  const { ogImage } = await load();
  const srv = await serveFixtures();
  const ours = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('pb-og-'));
  try {
    const before = ours();
    await assert.rejects(
      ogImage({ url: `${srv.url}/section.html`, selector: '#nope', out: path.join(tmpDir(), 'x.png') }),
      (e) => e.code === 'ENOSELECTOR',
    );
    assert.deepEqual(ours(), before, 'no leaked pb-og-* temp dir');
  } finally { await srv.close(); }
});

qtest('ogImage pads a narrow section to 1200 wide, centred, never stretched', async () => {
  const { ogImage, loadRaw } = await load();
  const srv = await serveFixtures();
  try {
    const r = await ogImage({ url: `${srv.url}/og-narrow.html`, selector: '#pb-s1', out: path.join(tmpDir(), 'narrow.png') });
    assert.deepEqual([r.width, r.height, r.source.width, r.source.height], [1200, 630, 900, 400]);
    const raw = await loadRaw(r.out);
    assert.deepEqual([raw.width, raw.height], [1200, 630]);
    const red = [0xdc, 0x26, 0x26];
    const blue = [0x1e, 0x3a, 0x8a];
    assert.deepEqual(px(raw, 10, 200), red, 'left side is the bottom-left padding colour');
    assert.deepEqual(px(raw, 1190, 200), red, 'right side is the bottom-left padding colour');
    assert.deepEqual(px(raw, 160, 200), red, 'native red band starts at x=150');
    assert.deepEqual(px(raw, 210, 200), blue, 'native scale: band is 50px wide');
    assert.deepEqual(px(raw, 600, 200), blue, 'section centred');
  } finally { await srv.close(); }
});

qtest('ogImage reports imageErrors for an image inside the shot section that never loads', { timeout: 60000 }, async () => {
  const { ogImage } = await load();
  const srv = await serveFixtures();
  const t0 = Date.now();
  try {
    const r = await ogImage({ url: `${srv.url}/og-hang.html`, selector: '#pb-s1', imageWaitMs: 1500, out: path.join(tmpDir(), 'e.png') });
    const took = `after ${Date.now() - t0}ms`;
    assert.ok(r.imageErrors.length > 0, `imageErrors is non-empty (${took})`);
    assert.match(r.imageErrors[0], /__hang/, `hanging image reported (${took})`);
    assert.deepEqual(r.pageImageWarnings, []);
  } finally { await srv.close(); }
});

qtest('ogImage reports a stalled image outside the shot section as a pageImageWarning, not an imageError', { timeout: 60000 }, async () => {
  const { ogImage } = await load();
  const srv = await serveFixtures();
  try {
    const r = await ogImage({ url: `${srv.url}/hang.html`, selector: '#pb-s1', imageWaitMs: 1500, out: path.join(tmpDir(), 'w.png') });
    assert.deepEqual(r.imageErrors, []);
    assert.equal(r.pageImageWarnings.length, 1);
    assert.match(r.pageImageWarnings[0], /__hang/);
  } finally { await srv.close(); }
});

qtest('og-image CLI exits 64 with usage when arguments are missing', async () => {
  const res = spawnSync(process.execPath, [path.join(QA_DIR, 'og-image.mjs'), '--url', 'http://x'], { encoding: 'utf8' });
  assert.equal(res.status, 64);
  assert.match(res.stderr, /Usage/);
});

// ---- supplied OG images (final-review fix wave) ----
const SCRIPTS = path.resolve(QA_DIR, '..');

qtest('fitOgImage cover-fits a supplied image to 1200x630, top-aligned', async () => {
  const { fitOgImage, loadRaw } = await load();
  const { makeImage } = await import('./helpers.mjs');
  const d = tmpDir();
  // 800x800: a red band on top, green below; cover-fit scales to 1200x1200 and keeps the top 630 rows.
  const src = await makeImage({ width: 800, height: 800, bg: [0x16, 0xa3, 0x4a], rects: [{ x: 0, y: 0, w: 800, h: 100, color: [0xdc, 0x26, 0x26] }] }, path.join(d, 'square.png'));
  const r = await fitOgImage(src, path.join(d, 'fit.png'));
  assert.deepEqual([r.resized, r.source.width, r.source.height], [true, 800, 800]);
  const raw = await loadRaw(r.out);
  assert.deepEqual([raw.width, raw.height], [1200, 630]);
  assert.deepEqual(px(raw, 600, 5), [0xdc, 0x26, 0x26], 'top kept');
  assert.deepEqual(px(raw, 600, 140), [0xdc, 0x26, 0x26], 'scaled 1.5x: the 100px band is 150px');
  assert.deepEqual(px(raw, 600, 629), [0x16, 0xa3, 0x4a]);
  const exact = await makeImage({ width: 1200, height: 630 }, path.join(d, 'exact.png'));
  const same = await fitOgImage(exact, path.join(d, 'unused.png'));
  assert.equal(same.resized, false);
  assert.equal(fs.existsSync(path.join(d, 'unused.png')), false, 'a 1200x630 image is not rewritten');
});

qtest('og-image CLI --fit prints the fit result as JSON', async () => {
  const { makeImage } = await import('./helpers.mjs');
  const d = tmpDir();
  const src = await makeImage({ width: 640, height: 480 }, path.join(d, 'in.png'));
  const res = spawnSync(process.execPath, [path.join(QA_DIR, 'og-image.mjs'), '--fit', src, '--out', path.join(d, 'o.png')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const r = JSON.parse(res.stdout);
  assert.equal(r.resized, true);
  assert.equal(r.out, path.join(d, 'o.png'));
  assert.equal(spawnSync(process.execPath, [path.join(QA_DIR, 'og-image.mjs'), '--fit', src], { encoding: 'utf8' }).status, 64);
});

qtest('applySeo resizes a supplied non-1200x630 OG image into the page artifacts before import', async () => {
  const { makeImage } = await import('./helpers.mjs');
  const { applySeo } = await import(path.join(SCRIPTS, 'lib', 'seo.mjs'));
  const { createWp } = await import(path.join(SCRIPTS, 'lib', 'wp.mjs'));
  const { initState, updateState, loadState } = await import(path.join(SCRIPTS, 'lib', 'state.mjs'));
  const { loadRaw } = await load();
  const theme = tmpDir('pb-og-theme-');
  initState(theme, { url: 'http://x.test', path: '/x' });
  updateState(theme, (s) => { s.pages.push({ slug: 'home', title: 'Home', status: 'seo', postId: 9, sections: [] }); });
  const supplied = await makeImage({ width: 1000, height: 1000 }, path.join(tmpDir(), 'supplied.png'));
  const imports = [];
  const exec = (cmd, args) => {
    if (args[0] === 'eval') return { code: 0, stdout: '1', stderr: '' };
    if (args[1]?.endsWith('media.php')) { imports.push(JSON.parse(Buffer.from(args[3], 'base64url').toString('utf8')).file); return { code: 0, stdout: '{"id":77,"url":"u","alt":"a","mime":"image/png","reused":false}\n', stderr: '' }; }
    if (args[2] === 'site') return { code: 0, stdout: '{"siteName":"Acme","sep":"-"}\n', stderr: '' };
    if (args[2] === 'get') return { code: 0, stdout: '{}\n', stderr: '' };
    if (args[2] === 'apply') return { code: 0, stdout: '{"postId":9,"written":[],"stored":{}}\n', stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  const seo = {
    focusKeyword: { value: 'emergency plumber', inferred: false },
    title: { value: 'Emergency Plumber %%sep%% %%sitename%%', inferred: false },
    description: { value: 'Licensed emergency plumbers in Austin available 24/7. Upfront pricing, same-day repairs and a 1-year guarantee on every job we do.', inferred: false },
    ogImage: { value: { file: supplied }, inferred: false },
  };
  const r = applySeo(createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }), theme, 'home', seo, { index: false });
  const out = path.join(theme, '.protoblocks', 'artifacts', 'home', 'og-supplied.png');
  assert.deepEqual(r.ogImage, { file: out, resized: true, source: { width: 1000, height: 1000 } });
  assert.deepEqual(imports, [fs.realpathSync(out)], 'the resized copy is imported, not the original');
  const raw = await loadRaw(out);
  assert.deepEqual([raw.width, raw.height], [1200, 630]);
  assert.equal(loadState(theme).pages[0].seo.ogImage.value.file, supplied, 'seo.json keeps the developer\'s file');
});
