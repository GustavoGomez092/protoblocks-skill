import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, makeImage, tmpDir, QA_DIR } from './helpers.mjs';

const lib = () => import(path.join(QA_DIR, 'image.mjs'));

async function fixture() {
  const { loadRaw } = await lib();
  const dir = tmpDir();
  const file = await makeImage({ width: 200, height: 100, bg: [255, 255, 255], rects: [{ x: 0, y: 0, w: 100, h: 100, color: [255, 0, 0] }] }, path.join(dir, 'a.png'));
  return { dir, file, raw: await loadRaw(file) };
}

qtest('loadRaw decodes dimensions and RGBA pixels', async () => {
  const { raw } = await fixture();
  assert.equal(raw.width, 200);
  assert.equal(raw.height, 100);
  assert.equal(raw.data.length, 200 * 100 * 4);
  assert.deepEqual([...raw.data.subarray(0, 4)], [255, 0, 0, 255]);
});

qtest('resizeToWidth scales preserving aspect ratio', async () => {
  const { resizeToWidth } = await lib();
  const { raw } = await fixture();
  const half = await resizeToWidth(raw, 100);
  assert.equal(half.width, 100);
  assert.equal(half.height, 50);
  assert.equal(half.data.length, 100 * 50 * 4);
  assert.equal(await resizeToWidth(raw, 200), raw);
});

qtest('cropRaw clamps to bounds', async () => {
  const { cropRaw } = await lib();
  const { raw } = await fixture();
  const crop = cropRaw(raw, { x: 150, y: 90, w: 100, h: 100 });
  assert.equal(crop.width, 50);
  assert.equal(crop.height, 10);
  assert.equal(crop.data.length, 50 * 10 * 4);
  assert.deepEqual([...crop.data.subarray(0, 4)], [255, 255, 255, 255]);
});

qtest('cropRaw handles out-of-bounds and zero-size crops', async () => {
  const { cropRaw } = await lib();
  const { raw } = await fixture();
  const out = cropRaw(raw, { x: 500, y: 0, w: 10, h: 10 });
  assert.ok(out.width === 0 || out.height === 0);
  assert.equal(out.data.length, 0);
  const zero = cropRaw(raw, { x: 10, y: 10, w: 0, h: 0 });
  assert.equal(zero.data.length, 0);
});

qtest('rawToPng writes a PNG that loadRaw round-trips', async () => {
  const { rawToPng, loadRaw, cropRaw } = await lib();
  const { dir, raw } = await fixture();
  const crop = cropRaw(raw, { x: 150, y: 90, w: 100, h: 100 });
  const out = await rawToPng(crop, path.join(dir, 'c.png'));
  const back = await loadRaw(out);
  assert.equal(back.width, 50);
  assert.equal(back.height, 10);
  assert.deepEqual(back.data, crop.data);
});
