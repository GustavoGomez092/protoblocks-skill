import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { itest, testWp } from './helpers.mjs';
import { importMedia, imageAttr } from '../../skills/protoblocks-site-builder/scripts/lib/media.mjs';

// Safety: tests delete only attachment ids returned by their own import, in finally. Never by query/name/hash.
const run = crypto.randomBytes(4).toString('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-media-'));

function randomPng(name) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = crypto.randomBytes((4 * 3 + 1) * 4);
  for (let r = 0; r < 4; r++) raw[r * 13] = 0;
  const file = path.join(tmp, name);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const meta = (wp, id, key) => wp.run(['post', 'meta', 'get', String(id), key]).stdout.trim();

itest('importMedia imports once, reuses on re-import, round-trips hostile alt, and requires alt', () => {
  const wp = testWp();
  const file = randomPng(`pb-itest-media-${run}-a.png`);
  const ids = [];
  try {
    const alt = '--path=/tmp "quotes" & ünïcode';
    const a = importMedia(wp, file, { alt });
    ids.push(a.id);
    assert.equal(a.reused, false);
    assert.equal(a.alt, alt);
    assert.equal(meta(wp, a.id, '_wp_attachment_image_alt'), alt);
    assert.equal(meta(wp, a.id, '_pb_source_hash'), sha1(file));
    const b = importMedia(wp, file, { alt: 'Acme logo (updated)' });
    assert.equal(b.reused, true);
    assert.equal(a.id, b.id);
    assert.equal(meta(wp, a.id, '_wp_attachment_image_alt'), 'Acme logo (updated)');
    const c = importMedia(wp, file, { alt: '' });
    assert.equal(c.id, a.id);
    assert.equal(c.alt, '');
    assert.deepEqual(Object.keys(imageAttr(b)), ['id', 'url', 'alt', 'caption', 'size']);
    assert.throws(() => importMedia(wp, file, {}), (e) => e.code === 'EALT');
  } finally {
    for (const id of ids) wp.run(['post', 'delete', String(id), '--force']);
  }
});

itest('a dedupe match whose file is missing on disk is not reused; the hash moves to the fresh attachment', () => {
  const wp = testWp();
  const file = randomPng(`pb-itest-media-${run}-stale.png`);
  const ids = [];
  try {
    const a = importMedia(wp, file, { alt: 'one' });
    ids.push(a.id);
    const stored = wp.check(['eval', `echo get_attached_file(${a.id});`]).trim();
    assert.ok(fs.existsSync(stored), `attached file exists: ${stored}`);
    fs.unlinkSync(stored);
    const b = importMedia(wp, file, { alt: 'two' });
    ids.push(b.id);
    assert.equal(b.reused, false);
    assert.notEqual(b.id, a.id);
    assert.equal(meta(wp, b.id, '_pb_source_hash'), sha1(file));
    assert.equal(meta(wp, a.id, '_pb_source_hash'), '');
    const c = importMedia(wp, file, { alt: 'three' });
    assert.equal(c.reused, true);
    assert.equal(c.id, b.id);
  } finally {
    for (const id of ids) wp.run(['post', 'delete', String(id), '--force']);
  }
});

itest('a rejected sideload (PNG extension, non-image bytes) fails cleanly and leaves no hash or attachment id behind', () => {
  const wp = testWp();
  const file = path.join(tmp, `pb-itest-media-${run}-fake.png`);
  fs.writeFileSync(file, `this is not a png ${run}`);
  let created = null;
  try {
    try {
      created = importMedia(wp, file, { alt: 'fake' });
    } catch (e) {
      assert.ok(['ETYPE', 'ESIDELOAD'].includes(e.code), `unexpected code ${e.code}: ${e.message}`);
      assert.doesNotMatch(e.message, /SVG/);
      const left = wp.check(['post', 'list', '--post_type=attachment', '--post_status=any', '--meta_key=_pb_source_hash', `--meta_value=${sha1(file)}`, '--format=ids']).trim();
      assert.equal(left, '', 'no attachment carries the hash of the rejected file');
      return;
    }
    assert.fail('WordPress accepted non-image bytes as a PNG');
  } finally {
    if (created) wp.run(['post', 'delete', String(created.id), '--force']);
  }
});

itest('SVG: either imports (site allows it) or fails with the clear ETYPE message and leaves no hash', (t) => {
  const wp = testWp();
  const file = path.join(tmp, `pb-itest-media-${run}-b.svg`);
  fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><!-- ${run} --><rect width="4" height="4"/></svg>`);
  let created = null;
  try {
    try {
      created = importMedia(wp, file, { alt: 'svg' });
    } catch (e) {
      assert.equal(e.code, 'ETYPE');
      assert.match(e.message, /SVG uploads are disabled on this site; convert to PNG or inline the SVG in the template/);
      const left = wp.check(['post', 'list', '--post_type=attachment', '--post_status=any', '--meta_key=_pb_source_hash', `--meta_value=${sha1(file)}`, '--format=ids']).trim();
      assert.equal(left, '', 'no attachment carries the hash of the rejected file');
      return;
    }
    t.diagnostic('this site accepts SVG uploads; the ETYPE branch is covered by the unit test');
    assert.equal(created.mime, 'image/svg+xml');
  } finally {
    if (created) wp.run(['post', 'delete', String(created.id), '--force']);
  }
});
