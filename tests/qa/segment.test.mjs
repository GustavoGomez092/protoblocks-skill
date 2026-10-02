import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { qtest, makeImage, tmpDir, QA_DIR } from './helpers.mjs';

const W = 600;
const CLI = path.join(QA_DIR, 'segment.mjs');
async function fixture(dir) {
  return makeImage({
    width: W, height: 900, bg: [255, 255, 255],
    rects: [
      { x: 200, y: 40, w: 200, h: 60, color: [0, 0, 0] },        // hero heading (white band 0-299)
      { x: 200, y: 200, w: 200, h: 40, color: [0, 0, 0] },       // hero CTA, 100px gap above
      { x: 0, y: 300, w: W, h: 300, color: [242, 242, 242] },    // grey band 300-599
      { x: 100, y: 380, w: 400, h: 140, color: [30, 30, 30] },   // content inside grey band
      { x: 0, y: 650, w: W, h: 3, color: [10, 10, 10] },         // thin full-width rule (3 rows) in last band - must not cut
      { x: 150, y: 700, w: 300, h: 120, color: [0, 0, 0] },      // footer content
    ],
  }, path.join(dir, 'page.png'));
}

qtest('findCuts finds background changes and ignores thin full-width rules', async () => {
  const { findCuts } = await import(path.join(QA_DIR, 'segment.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const raw = await loadRaw(await fixture(tmpDir()));
  const r = findCuts(raw);
  const bg = r.cuts.filter((c) => c.kind === 'background').map((c) => c.y);
  assert.deepEqual(bg, [300, 600]);
  assert.deepEqual(r.bands.map((b) => [b.y0, b.y1]), [[0, 300], [300, 600], [600, 900]]);
  assert.ok(r.cuts.some((c) => c.kind === 'gap' && c.y > 100 && c.y < 200), JSON.stringify(r.cuts));
});

qtest('a full-width photo band whose left/right edges differ creates no spurious cuts', async () => {
  const { findCuts } = await import(path.join(QA_DIR, 'segment.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const file = await makeImage({
    width: W, height: 900, bg: [255, 255, 255],
    rects: [
      // photo band 300-599: dark left half, light right half -> edge colours disagree on every row
      { x: 0, y: 300, w: 300, h: 300, color: [20, 30, 40] },
      { x: 300, y: 300, w: 300, h: 300, color: [200, 180, 150] },
      // a 10-row full-width stripe inside the photo whose edges agree (looks like a background change)
      { x: 0, y: 420, w: W, h: 10, color: [100, 100, 100] },
      { x: 0, y: 600, w: W, h: 300, color: [200, 220, 240] },    // plain blue band 600-899
    ],
  }, path.join(tmpDir(), 'photo.png'));
  const r = findCuts(await loadRaw(file));
  // The photo is its own band (null background): cut into it at 300, out of it at 600.
  // The internal 10-row stripe is shorter than minBand, so it creates no cut.
  const bgCuts = r.cuts.filter((c) => c.kind === 'background');
  assert.deepEqual(bgCuts.map((c) => c.y), [300, 600]);
  assert.equal(bgCuts[0].to, null);
  assert.equal(bgCuts[1].from, null);
  assert.deepEqual(bgCuts[1].to, [200, 220, 240]);
  assert.deepEqual(r.cuts.filter((c) => c.y > 300 && c.y < 600), [], JSON.stringify(r.cuts));
  assert.deepEqual(r.bands.map((b) => [b.y0, b.y1, b.bg === null]), [[0, 300, false], [300, 600, true], [600, 900, false]]);
});

qtest('a photo hero at the top is band 0 and is cut at its bottom edge', async () => {
  const { findCuts } = await import(path.join(QA_DIR, 'segment.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const file = await makeImage({
    width: W, height: 600, bg: [255, 255, 255],
    rects: [
      { x: 0, y: 0, w: 300, h: 250, color: [20, 30, 40] },
      { x: 300, y: 0, w: 300, h: 250, color: [200, 180, 150] },
    ],
  }, path.join(tmpDir(), 'hero.png'));
  const r = findCuts(await loadRaw(file));
  const bg = r.cuts.filter((c) => c.kind === 'background');
  assert.deepEqual(bg.map((c) => c.y), [250]);
  assert.equal(bg[0].from, null);
  assert.deepEqual(r.bands.map((b) => [b.y0, b.y1]), [[0, 250], [250, 600]]);
});

qtest('edge-touching text rows inside a solid band do not split it or hide a later cut', async () => {
  const { findCuts } = await import(path.join(QA_DIR, 'segment.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const rects = [{ x: 0, y: 300, w: W, h: 300, color: [242, 242, 242] }];
  // a 1-2 row dark mark touching the left edge only, every 30 rows (edges disagree on those rows)
  for (let y = 20; y < 300; y += 30) rects.push({ x: 0, y, w: 50, h: 1 + (y / 30) % 2, color: [0, 0, 0] });
  const file = await makeImage({ width: W, height: 600, bg: [255, 255, 255], rects }, path.join(tmpDir(), 'text.png'));
  const r = findCuts(await loadRaw(file));
  assert.deepEqual(r.cuts.filter((c) => c.kind === 'background').map((c) => c.y), [300]);
  assert.equal(r.bands.length, 2);
});

qtest('a background colour change shorter than minBand produces no cut', async () => {
  const { findCuts } = await import(path.join(QA_DIR, 'segment.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const file = await makeImage({
    width: W, height: 400, bg: [255, 255, 255],
    rects: [{ x: 0, y: 150, w: W, h: 20, color: [200, 0, 0] }],
  }, path.join(tmpDir(), 'strip.png'));
  const r = findCuts(await loadRaw(file));
  assert.deepEqual(r.cuts.filter((c) => c.kind === 'background'), []);
  assert.equal(r.bands.length, 1);
});

qtest('cropRanges writes named crops', async () => {
  const { cropRanges } = await import(path.join(QA_DIR, 'segment.mjs'));
  const dir = tmpDir();
  const file = await fixture(dir);
  const out = await cropRanges(file, [{ name: 's1', y0: 0, y1: 300 }, { name: 's2', y0: 300, y1: 600 }], path.join(dir, 'crops'));
  assert.deepEqual(out.map((o) => [o.name, o.width, o.height]), [['s1', W, 300], ['s2', W, 300]]);
  assert.ok(fs.existsSync(out[1].file));
});

qtest('cropRanges rejects bad names and bad/out-of-bounds ranges with ERANGES and writes nothing', async () => {
  const { cropRanges } = await import(path.join(QA_DIR, 'segment.mjs'));
  const dir = tmpDir();
  const file = await fixture(dir);
  const out = path.join(dir, 'crops');
  const bad = [
    [{ y0: 0, y1: 10 }, /name/],
    [{ name: '../evil', y0: 0, y1: 10 }, /\.\.\/evil/],
    [{ name: 'a/b', y0: 0, y1: 10 }, /a\/b/],
    [{ name: 'a.b', y0: 0, y1: 10 }, /a\.b/],
    [{ name: 'empty', y0: 50, y1: 50 }, /empty/],
    [{ name: 'inverted', y0: 60, y1: 50 }, /inverted/],
    [{ name: 'xinv', y0: 0, y1: 10, x0: 300, x1: 100 }, /xinv/],
    [{ name: 'neg', y0: -1, y1: 10 }, /neg/],
    [{ name: 'tall', y0: 0, y1: 901 }, /tall/],
    [{ name: 'wide', y0: 0, y1: 10, x1: W + 1 }, /wide/],
    [{ name: 'nan', y0: 'a', y1: 10 }, /nan/],
  ];
  for (const [range, re] of bad) {
    await assert.rejects(cropRanges(file, [{ name: 'ok', y0: 0, y1: 10 }, range], out), (e) => e.code === 'ERANGES' && re.test(e.message), JSON.stringify(range));
  }
  assert.equal(fs.existsSync(out), false, 'validation must happen before any file is written');
});

qtest('cropRanges rejects a non-array ranges argument with ERANGES', async () => {
  const { cropRanges } = await import(path.join(QA_DIR, 'segment.mjs'));
  const dir = tmpDir();
  const file = await fixture(dir);
  await assert.rejects(cropRanges(file, { name: 'a', y0: 0, y1: 10 }, path.join(dir, 'o')), (e) => e.code === 'ERANGES' && /array/.test(e.message));
});

qtest('CLI flag with a missing value is a usage error (exit 64)', async () => {
  const dir = tmpDir();
  const file = await fixture(dir);
  for (const args of [['crop', file, '--out', path.join(dir, 'o'), '--ranges'], ['crop', file, '--ranges', '--out', path.join(dir, 'o')], ['analyze', file, '--verbose']]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 64, r.stderr);
    assert.match(r.stderr, /Usage/);
  }
});

qtest('CLI analyze prints the findCuts JSON shape', async () => {
  const file = await fixture(tmpDir());
  const r = spawnSync(process.execPath, [CLI, 'analyze', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.width, W);
  assert.equal(j.height, 900);
  assert.ok(Array.isArray(j.cuts) && Array.isArray(j.bands));
  assert.deepEqual(j.cuts.filter((c) => c.kind === 'background').map((c) => c.y), [300, 600]);
});

qtest('CLI crop with unparseable --ranges exits 1 with a clear stderr message, no stack trace', async () => {
  const dir = tmpDir();
  const file = await fixture(dir);
  const r = spawnSync(process.execPath, [CLI, 'crop', file, '--ranges', '{not json', '--out', path.join(dir, 'o')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--ranges/);
  assert.match(r.stderr, /JSON/i);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

qtest('CLI crop writes crops and an invalid range exits 1', async () => {
  const dir = tmpDir();
  const file = await fixture(dir);
  const ok = spawnSync(process.execPath, [CLI, 'crop', file, '--ranges', JSON.stringify([{ name: 'a', y0: 0, y1: 100 }]), '--out', path.join(dir, 'o')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout)[0].height, 100);
  const bad = spawnSync(process.execPath, [CLI, 'crop', file, '--ranges', JSON.stringify([{ name: 'a', y0: 0, y1: 5000 }]), '--out', path.join(dir, 'o2')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /ERANGES|out of bounds/);
});
