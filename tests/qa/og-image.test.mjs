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

qtest('ogImage reports imageErrors for an image that never loads', { timeout: 30000 }, async () => {
  const { ogImage } = await load();
  const srv = await serveFixtures();
  try {
    const r = await ogImage({ url: `${srv.url}/hang.html`, selector: '#pb-s1', out: path.join(tmpDir(), 'e.png') });
    assert.ok(r.imageErrors.length > 0, 'imageErrors is non-empty');
    assert.match(r.imageErrors[0], /__hang/);
  } finally { await srv.close(); }
});

qtest('og-image CLI exits 64 with usage when arguments are missing', async () => {
  const res = spawnSync(process.execPath, [path.join(QA_DIR, 'og-image.mjs'), '--url', 'http://x'], { encoding: 'utf8' });
  assert.equal(res.status, 64);
  assert.match(res.stderr, /Usage/);
});
