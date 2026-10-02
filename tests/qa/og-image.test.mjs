import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

qtest('ogImage reports imageErrors from the shot', async () => {
  const { ogImage } = await load();
  const srv = await serveFixtures();
  try {
    const r = await ogImage({ url: `${srv.url}/section.html`, selector: '#pb-s1', out: path.join(tmpDir(), 'e.png') });
    assert.ok(Array.isArray(r.imageErrors), 'imageErrors is an array');
  } finally { await srv.close(); }
});
