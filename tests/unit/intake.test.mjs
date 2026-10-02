import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { inferScale, imageWidth, addFrame, ensurePage, cropSections, framesFromUrl } from '../../skills/protoblocks-site-builder/scripts/lib/intake.mjs';
import { initState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

function png(width, height, file) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

test('inferScale handles 1x, @2x desktop, @3x mobile and rejects odd widths', () => {
  assert.deepEqual(inferScale(1440, 'desktop'), { cssWidth: 1440, scale: 1 });
  assert.deepEqual(inferScale(2880, 'desktop'), { cssWidth: 1440, scale: 2 });
  assert.deepEqual(inferScale(1170, 'mobile'), { cssWidth: 390, scale: 3 });
  assert.deepEqual(inferScale(750, 'mobile'), { cssWidth: 375, scale: 2 });
  assert.deepEqual(inferScale(1668, 'tablet'), { cssWidth: 834, scale: 2 });
  assert.equal(inferScale(5000, 'desktop'), null);
  assert.equal(inferScale(1001, 'mobile'), null);
});

test('imageWidth reads PNG headers', () => {
  const f = png(37, 5, path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-in-')), 'a.png'));
  assert.equal(imageWidth(f), 37);
});

test('addFrame copies the image into artifacts and records scale; ESCALE without width', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-in-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  const src = png(2880, 10, path.join(theme, 'home@2x.png'));
  const f = addFrame(theme, 'home', 'desktop', src, { title: 'Home' });
  assert.equal(f.width, 1440);
  assert.equal(f.scale, 2);
  assert.ok(f.image.endsWith(path.join('artifacts', 'home', 'design', 'desktop.png')));
  assert.ok(fs.existsSync(f.image));
  const st = loadState(theme);
  assert.equal(st.pages[0].slug, 'home');
  assert.equal(st.pages[0].title, 'Home');
  assert.equal(st.pages[0].design.frames.length, 1);
  addFrame(theme, 'home', 'desktop', src);
  assert.equal(loadState(theme).pages[0].design.frames.length, 1, 'replaced, not duplicated');
  const odd = png(1000, 10, path.join(theme, 'odd.png'));
  assert.throws(() => addFrame(theme, 'home', 'desktop', odd), (e) => e.code === 'ESCALE');
  assert.equal(addFrame(theme, 'home', 'desktop', odd, { width: 1000 }).scale, 1);
});

test('ensurePage creates a planning page once', () => {
  const s = { pages: [] };
  ensurePage(s, 'about', 'About');
  ensurePage(s, 'about');
  assert.equal(s.pages.length, 1);
  assert.equal(s.pages[0].status, 'planning');
});

test('addFrame rejects non-integer/non-positive --width with ESCALE and writes nothing', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-in-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  const src = png(780, 10, path.join(theme, 'm.png'));
  for (const w of ['abc', 0, -5, 390.5, '390.5', Infinity]) {
    assert.throws(() => addFrame(theme, 'home', 'mobile', src, { width: w }), (e) => e.code === 'ESCALE', String(w));
  }
  assert.equal(fs.existsSync(path.join(theme, '.protoblocks', 'artifacts')), false, 'nothing copied');
  assert.equal(loadState(theme).pages.length, 0);
  assert.equal(addFrame(theme, 'home', 'mobile', src, { width: '390' }).scale, 2);
});

test('imageWidth throws EIMAGE on truncated or corrupt images', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-in-'));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const short = path.join(dir, 'short.png');
  fs.writeFileSync(short, Buffer.concat([sig, Buffer.alloc(12)]));
  assert.equal(Buffer.concat([sig, Buffer.alloc(12)]).length, 20);
  assert.throws(() => imageWidth(short), (e) => e.code === 'EIMAGE');
  const w20 = path.join(dir, 'w20.png');
  fs.writeFileSync(w20, Buffer.concat([sig, Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 5, 160])]));
  assert.throws(() => imageWidth(w20), (e) => e.code === 'EIMAGE', '20-byte header-only PNG');
  const notIhdr = path.join(dir, 'noihdr.png');
  fs.writeFileSync(notIhdr, Buffer.concat([sig, Buffer.from([0, 0, 0, 13]), Buffer.from('IDAT'), Buffer.alloc(20)]));
  assert.throws(() => imageWidth(notIhdr), (e) => e.code === 'EIMAGE');
  const midSeg = path.join(dir, 'mid.jpg');
  fs.writeFileSync(midSeg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 0x00, 0x01]));
  assert.throws(() => imageWidth(midSeg), (e) => e.code === 'EIMAGE');
  const truncSof = path.join(dir, 'sof.jpg');
  fs.writeFileSync(truncSof, Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00]));
  assert.throws(() => imageWidth(truncSof), (e) => e.code === 'EIMAGE');
});

test('cropSections validates ranges with ERANGES before cropping anything', async () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-in-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  addFrame(theme, 'home', 'desktop', png(1440, 10, path.join(theme, 'd.png')));
  const bad = [
    { desktop: [{ n: 0, y0: 0, y1: 5 }] },
    { desktop: [{ n: 1.5, y0: 0, y1: 5 }] },
    { desktop: [{ n: 1, y0: -1, y1: 5 }] },
    { desktop: [{ n: 1, y0: 5, y1: 5 }] },
    { desktop: [{ n: 1, y0: 0, y1: NaN }] },
    { desktop: [{ n: 1, y0: 0.5, y1: 5 }] },
    { watch: [{ n: 1, y0: 0, y1: 5 }] },
    { desktop: [{ n: 1, y0: 0, y1: 5 }, { n: 2, y0: 9, y1: 3 }] },
  ];
  for (const r of bad) await assert.rejects(() => cropSections(theme, 'home', r), (e) => e.code === 'ERANGES', JSON.stringify(r));
  assert.equal(fs.existsSync(path.join(theme, '.protoblocks', 'artifacts', 'home', 'crops')), false);
  assert.equal(loadState(theme).pages[0].sections.length, 0);
});

test('framesFromUrl rejects empty/invalid widths with EWIDTHS', async () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-in-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  await assert.rejects(() => framesFromUrl(theme, 'home', 'http://a.local', [NaN, 0, -3]), (e) => e.code === 'EWIDTHS');
  await assert.rejects(() => framesFromUrl(theme, 'home', 'http://a.local', []), (e) => e.code === 'EWIDTHS');
});
