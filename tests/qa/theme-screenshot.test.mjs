import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { qtest, tmpDir, makeImage, QA_DIR } from './helpers.mjs';
import { initState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { addFrame } from '../../skills/protoblocks-site-builder/scripts/lib/intake.mjs';

const SCRIPT = new URL('../../skills/protoblocks-site-builder/scripts/lib/theme-screenshot.mjs', import.meta.url).pathname;
const px = (raw, x, y) => { const i = (y * raw.width + x) * 4; return [...raw.data.subarray(i, i + 3)]; };
const RED = [0xdc, 0x26, 0x26];
const GREEN = [0x16, 0xa3, 0x4a];
const BLUE = [0x1e, 0x3a, 0x8a];

// A fork with a build state and the page's desktop frame intaken from `file`.
function forkWithFrame(file) {
  const theme = tmpDir('pb-shot-qa-');
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: Acme\nProto Fork: proto-blocks-theme@1.0.0\n*/');
  initState(theme, { url: 'http://a.local', path: '/x', theme: { slug: 'acme' } });
  addFrame(theme, 'home', 'desktop', file, { title: 'Home' });
  return theme;
}

qtest('cropTopToSize keeps the top of a tall frame at full width (4:3) and resizes it to the target', async () => {
  const { cropTopToSize, loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  // 1440x2000: red for the first 1080px (the 4:3 crop), green below it.
  const frame = await makeImage({ width: 1440, height: 2000, bg: GREEN, rects: [{ x: 0, y: 0, w: 1440, h: 1080, color: RED }] }, path.join(tmpDir(), 'frame.png'));
  const out = path.join(tmpDir(), 'shot.png');
  const r = await cropTopToSize(frame, out, { width: 1200, height: 900 });
  assert.deepEqual([r.source, r.crop, r.width, r.height], [{ width: 1440, height: 2000 }, { width: 1440, height: 1080 }, 1200, 900]);
  const raw = await loadRaw(out);
  assert.deepEqual([raw.width, raw.height], [1200, 900]);
  assert.deepEqual(px(raw, 5, 5), RED);
  assert.deepEqual(px(raw, 1194, 894), RED, 'the whole 1440x1080 crop is red: nothing below y 1080 is in the screenshot');
});

qtest('cropTopToSize pads a frame shorter than 4:3 with its bottom-left colour, never stretches it', async () => {
  const { cropTopToSize, loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  // 1200x600 (needs 900): red top 300px, blue below; padding takes the blue from the bottom-left pixel.
  const frame = await makeImage({ width: 1200, height: 600, bg: BLUE, rects: [{ x: 0, y: 0, w: 1200, h: 300, color: RED }] }, path.join(tmpDir(), 'short.png'));
  const out = path.join(tmpDir(), 'short-shot.png');
  const r = await cropTopToSize(frame, out, { width: 1200, height: 900 });
  assert.deepEqual([r.source, r.crop], [{ width: 1200, height: 600 }, { width: 1200, height: 900 }]);
  const raw = await loadRaw(out);
  assert.deepEqual([raw.width, raw.height], [1200, 900]);
  assert.deepEqual(px(raw, 5, 298), RED, 'content kept at native scale');
  assert.deepEqual(px(raw, 5, 302), BLUE);
  assert.deepEqual(px(raw, 5, 898), BLUE, 'padding uses the bottom-left colour');
});

qtest('theme-screenshot.mjs writes <theme>/screenshot.png from the intaken desktop frame (PNG and JPEG) and records state', async () => {
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const sharp = createRequire(path.join(QA_DIR, 'package.json'))('sharp');
  const png = await makeImage({ width: 1440, height: 3000, bg: GREEN, rects: [{ x: 0, y: 0, w: 1440, h: 1080, color: RED }] }, path.join(tmpDir(), 'frame.png'));
  const jpg = path.join(tmpDir(), 'frame.jpg');
  await sharp(png).jpeg({ quality: 100 }).toFile(jpg);
  for (const file of [png, jpg]) {
    const theme = forkWithFrame(file);
    const r = spawnSync(process.execPath, [SCRIPT, theme, 'home'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.out, path.join(theme, 'screenshot.png'));
    assert.deepEqual([out.page, out.source, out.crop, out.width, out.height], ['home', { width: 1440, height: 3000 }, { width: 1440, height: 1080 }, 1200, 900]);
    assert.equal(out.frame, loadState(theme).pages.find((p) => p.slug === 'home').design.frames[0].image);
    const raw = await loadRaw(out.out);
    assert.deepEqual([raw.width, raw.height], [1200, 900]);
    const [rr, g, b] = px(raw, 600, 450);
    assert.ok(rr > 200 && g < 80 && b < 80, `red at the centre (${file}): ${[rr, g, b]}`);
    assert.deepEqual(loadState(theme).site.theme.screenshot, { page: 'home', source: 'frame', writtenAt: out.writtenAt });
  }
});
