import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qtest, makeImage, tmpDir, QA_DIR } from './helpers.mjs';

const load = () => import(path.join(QA_DIR, 'diff.mjs'));

qtest('identical images have zero mismatch', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const spec = { width: 300, height: 200, rects: [{ x: 20, y: 20, w: 100, h: 40, color: [0, 0, 0] }] };
  const a = await makeImage(spec, path.join(d, 'a.png'));
  const b = await makeImage(spec, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b, out: path.join(d, 'c.png') });
  assert.equal(r.mismatch, 0);
  assert.equal(r.heightDelta, 0);
  assert.ok(fs.existsSync(r.composite));
});

qtest('a moved block produces mismatch proportional to changed pixels', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 100, height: 100, rects: [{ x: 0, y: 0, w: 10, h: 10, color: [0, 0, 0] }] }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 100, rects: [{ x: 50, y: 50, w: 10, h: 10, color: [0, 0, 0] }] }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b });
  assert.equal(r.diffPixels, 200);
  assert.equal(r.mismatch, 0.02);
});

qtest('masks exclude regions from score and denominator', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 100, height: 100, rects: [{ x: 0, y: 0, w: 10, h: 10, color: [0, 0, 0] }] }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 100 }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b, masks: [{ x: 0, y: 0, w: 20, h: 20 }] });
  assert.equal(r.diffPixels, 0);
  assert.equal(r.comparedPixels, 100 * 100 - 400);
});

qtest('taller render: heightDelta reported, overlap compared, no crash', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 100, height: 100 }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 120 }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b, out: path.join(d, 'c.png') });
  assert.equal(r.heightDelta, 0.2);
  assert.equal(r.mismatch, 0);
  assert.equal(r.renderHeight, 120);
});

qtest('half-width render is scaled up to the design width (retina design)', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 200, height: 200, rects: [{ x: 0, y: 0, w: 100, h: 200, color: [0, 0, 255] }] }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 100, rects: [{ x: 0, y: 0, w: 50, h: 100, color: [0, 0, 255] }] }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b });
  assert.equal(r.width, 200);
  assert.equal(r.heightDelta, 0);
  assert.ok(r.mismatch < 0.02, `mismatch ${r.mismatch}`);
});

qtest('compareRaw rejects different widths', async () => {
  const { compareRaw } = await load();
  const raw = (w) => ({ data: Buffer.alloc(w * 4 * 2), width: w, height: 2 });
  assert.throws(() => compareRaw(raw(2), raw(3)), (e) => e.code === 'EWIDTH');
});

qtest('taller render is compared top-aligned, not bottom-aligned', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const block = { x: 10, y: 5, w: 30, h: 20, color: [0, 0, 0] };
  const a = await makeImage({ width: 100, height: 100, rects: [block] }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 160, rects: [block] }, path.join(d, 'b.png'));
  const r = await diffImages({ design: a, render: b });
  assert.equal(r.diffPixels, 0);
  assert.equal(r.comparedPixels, 100 * 100);
});

qtest('composite is a valid PNG wider than the three panels', async () => {
  const { diffImages } = await load();
  const d = tmpDir();
  const a = await makeImage({ width: 100, height: 50 }, path.join(d, 'a.png'));
  const b = await makeImage({ width: 100, height: 50 }, path.join(d, 'b.png'));
  const out = path.join(d, 'c.png');
  const r = await diffImages({ design: a, render: b, out });
  assert.equal(r.composite, out);
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const img = await loadRaw(out);
  assert.equal(img.width, 3 * 100 + 4 * 16);
  assert.equal(img.height, 50 + 2 * 16);
});
