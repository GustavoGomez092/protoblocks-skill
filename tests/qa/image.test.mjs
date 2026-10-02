import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, makeImage, tmpDir, QA_DIR } from './helpers.mjs';

qtest('loadRaw / resizeToWidth / cropRaw / rawToPng', async () => {
  const { loadRaw, resizeToWidth, cropRaw, rawToPng } = await import(path.join(QA_DIR, 'image.mjs'));
  const dir = tmpDir();
  const file = await makeImage({ width: 200, height: 100, bg: [255, 255, 255], rects: [{ x: 0, y: 0, w: 100, h: 100, color: [255, 0, 0] }] }, path.join(dir, 'a.png'));
  const raw = await loadRaw(file);
  assert.equal(raw.width, 200);
  assert.equal(raw.height, 100);
  assert.deepEqual([...raw.data.subarray(0, 4)], [255, 0, 0, 255]);
  const half = await resizeToWidth(raw, 100);
  assert.equal(half.width, 100);
  assert.equal(half.height, 50);
  const crop = cropRaw(raw, { x: 150, y: 90, w: 100, h: 100 });
  assert.equal(crop.width, 50);
  assert.equal(crop.height, 10);
  assert.deepEqual([...crop.data.subarray(0, 4)], [255, 255, 255, 255]);
  const out = await rawToPng(crop, path.join(dir, 'c.png'));
  assert.equal((await loadRaw(out)).width, 50);
});
