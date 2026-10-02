import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { after } from 'node:test';
import { itest, testWp, runtime } from './helpers.mjs';
import { createWp, WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { importMedia, imageAttr } from '../../skills/protoblocks-site-builder/scripts/lib/media.mjs';

// Safety: tests delete only attachment ids returned by their own import, in finally. Never by query/name/hash.
const run = crypto.randomBytes(4).toString('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-media-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Import and remember the id (also from a typed error that carries e.id) so `finally` can delete exactly what we made.
const imp = (wp, ids, file, opts) => {
  try {
    const m = importMedia(wp, file, opts);
    ids.push(m.id);
    return m;
  } catch (e) {
    if (e.id) ids.push(e.id);
    throw e;
  }
};
const cleanup = (wp, ids) => { for (const id of ids) wp.run(['post', 'delete', String(id), '--force']); };

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
    const a = imp(wp, ids, file, { alt });
    assert.equal(a.reused, false);
    assert.equal(a.alt, alt);
    assert.equal(meta(wp, a.id, '_wp_attachment_image_alt'), alt);
    assert.equal(meta(wp, a.id, '_pb_source_hash'), sha1(file));
    const b = imp(wp, ids, file, { alt: 'Acme logo (updated)' });
    assert.equal(b.reused, true);
    assert.equal(a.id, b.id);
    assert.equal(meta(wp, a.id, '_wp_attachment_image_alt'), 'Acme logo (updated)');
    const c = imp(wp, ids, file, { alt: '' });
    assert.equal(c.id, a.id);
    assert.equal(c.alt, '');
    assert.deepEqual(Object.keys(imageAttr(b)), ['id', 'url', 'alt', 'caption', 'size']);
    assert.throws(() => importMedia(wp, file, {}), (e) => e.code === 'EALT');
  } finally {
    cleanup(wp, ids);
  }
});

itest('a dedupe match whose file is missing on disk is not reused; the hash moves to the fresh attachment', () => {
  const wp = testWp();
  const file = randomPng(`pb-itest-media-${run}-stale.png`);
  const ids = [];
  try {
    const a = imp(wp, ids, file, { alt: 'one' });
    const stored = wp.check(['eval', `echo get_attached_file(${a.id});`]).trim();
    assert.ok(fs.existsSync(stored), `attached file exists: ${stored}`);
    fs.unlinkSync(stored);
    const b = imp(wp, ids, file, { alt: 'two' });
    assert.equal(b.reused, false);
    assert.notEqual(b.id, a.id);
    assert.equal(meta(wp, b.id, '_pb_source_hash'), sha1(file));
    assert.equal(meta(wp, a.id, '_pb_source_hash'), '');
    const c = imp(wp, ids, file, { alt: 'three' });
    assert.equal(c.reused, true);
    assert.equal(c.id, b.id);
  } finally {
    cleanup(wp, ids);
  }
});

itest('a trashed attachment with the same hash is ignored: re-import creates a fresh attachment', () => {
  const wp = testWp();
  const file = randomPng(`pb-itest-media-${run}-trash.png`);
  const ids = [];
  try {
    const a = imp(wp, ids, file, { alt: 'one' });
    wp.check(['post', 'update', String(a.id), '--post_status=trash']);
    const b = imp(wp, ids, file, { alt: 'two' });
    assert.equal(b.reused, false);
    assert.notEqual(b.id, a.id);
  } finally {
    cleanup(wp, ids);
  }
});

itest('a rejected sideload (PNG extension, non-image bytes) fails with exactly ETYPE and leaves no hash', () => {
  const wp = testWp();
  const file = path.join(tmp, `pb-itest-media-${run}-fake.png`);
  fs.writeFileSync(file, `this is not a png ${run}`);
  const ids = [];
  try {
    assert.throws(() => imp(wp, ids, file, { alt: 'fake' }), (e) => e.code === 'ETYPE' && /file type not allowed on this site: png/.test(e.message));
    assert.equal(ids.length, 0);
    const left = wp.check(['post', 'list', '--post_type=attachment', '--post_status=any', '--meta_key=_pb_source_hash', `--meta_value=${sha1(file)}`, '--format=ids']).trim();
    assert.equal(left, '', 'no attachment carries the hash of the rejected file');
  } finally {
    cleanup(wp, ids);
  }
});

itest('SVG rejected by WordPress (upload_mimes without svg) gives exactly ETYPE with the clear message', () => {
  const wp = createWp(runtime, { extraArgs: ['--exec=WP_CLI::add_hook("after_wp_load", function(){ add_filter("upload_mimes", function($m){ unset($m["svg"]); unset($m["svgz"]); return $m; }); });'] });
  const file = path.join(tmp, `pb-itest-media-${run}-b.svg`);
  fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><!-- ${run} --><rect width="4" height="4"/></svg>`);
  const ids = [];
  try {
    assert.throws(() => imp(wp, ids, file, { alt: 'svg' }), (e) => e.code === 'ETYPE' && /SVG uploads are disabled on this site; convert to PNG or inline the SVG in the template/.test(e.message));
    assert.equal(ids.length, 0);
    const left = wp.check(['post', 'list', '--post_type=attachment', '--post_status=any', '--meta_key=_pb_source_hash', `--meta_value=${sha1(file)}`, '--format=ids']).trim();
    assert.equal(left, '');
  } finally {
    cleanup(wp, ids);
  }
});

itest('media.php rejects a relative file path in the payload (EUSAGE) and over-long titles (ETITLE)', () => {
  const wp = testWp();
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const php = path.join(WP_SCRIPTS_DIR, 'media.php');
  const rel = wp.evalFile(php, ['import', enc({ file: `pb-itest-media-${run}-rel.png`, alt: 'a', title: '' })]);
  assert.equal(rel.error?.code, 'EUSAGE');
  const real = randomPng(`pb-itest-media-${run}-title.png`);
  const long = wp.evalFile(php, ['import', enc({ file: real, alt: 'a', title: 't'.repeat(201) })]);
  assert.equal(long.error?.code, 'ETITLE');
  const left = wp.check(['post', 'list', '--post_type=attachment', '--post_status=any', '--meta_key=_pb_source_hash', `--meta_value=${sha1(real)}`, '--format=ids']).trim();
  assert.equal(left, '');
});
