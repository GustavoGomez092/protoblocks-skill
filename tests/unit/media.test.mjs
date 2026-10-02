import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { importMedia, imageAttr, parseFlags } from '../../skills/protoblocks-site-builder/scripts/lib/media.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-mu-'));
const png = path.join(dir, 'a.png');
fs.writeFileSync(png, 'x');
const fakeWp = (stdout = '{"id":5,"url":"u","alt":"a","mime":"image/png","reused":false}\n') => {
  const calls = [];
  const exec = (cmd, args) => { calls.push(args); return { code: 0, stdout, stderr: '' }; };
  return { wp: createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }), calls };
};
const code = (c) => (e) => e.code === c;

test('missing, non-string and over-long alt is EALT; empty alt is allowed', () => {
  const { wp, calls } = fakeWp();
  assert.throws(() => importMedia(wp, png, {}), code('EALT'));
  assert.throws(() => importMedia(wp, png), code('EALT'));
  assert.throws(() => importMedia(wp, png, { alt: 5 }), code('EALT'));
  assert.throws(() => importMedia(wp, png, { alt: null }), code('EALT'));
  assert.throws(() => importMedia(wp, png, { alt: 'x'.repeat(1001) }), code('EALT'));
  assert.equal(calls.length, 0);
  importMedia(wp, png, { alt: '' });
  importMedia(wp, png, { alt: 'x'.repeat(1000) });
  assert.equal(calls.length, 2);
});

test('an alt starting with -- never appears raw in argv; payload round-trips', () => {
  const { wp, calls } = fakeWp();
  const alt = '--path=/tmp "quotes" & ünïcode';
  importMedia(wp, png, { alt, title: '--require=/evil.php' });
  const argv = calls[0];
  assert.equal(argv.length, 4); // eval-file <php> import <payload>
  assert.equal(argv[2], 'import');
  for (const a of argv.slice(2)) assert.ok(!a.startsWith('--') && !a.includes('quotes') && !a.includes('evil'), a);
  assert.match(argv[3], /^[A-Za-z0-9_-]+$/);
  const payload = JSON.parse(Buffer.from(argv[3], 'base64url').toString('utf8'));
  assert.deepEqual(payload, { file: fs.realpathSync(png), alt, title: '--require=/evil.php' });
});

test('file must exist and be a regular file (EFILE) of an image type (ETYPE)', () => {
  const { wp, calls } = fakeWp();
  assert.throws(() => importMedia(wp, path.join(dir, 'nope.png'), { alt: 'a' }), code('EFILE'));
  assert.throws(() => importMedia(wp, dir, { alt: 'a' }), code('EFILE'));
  const txt = path.join(dir, 'a.txt'); fs.writeFileSync(txt, 'x');
  assert.throws(() => importMedia(wp, txt, { alt: 'a' }), code('ETYPE'));
  const sym = path.join(dir, 'link.png'); fs.symlinkSync(png, sym);
  importMedia(wp, sym, { alt: 'a' });
  assert.equal(JSON.parse(Buffer.from(calls[0][3], 'base64url')).file, fs.realpathSync(png));
  const dangling = path.join(dir, 'dangling.png'); fs.symlinkSync(path.join(dir, 'gone'), dangling);
  assert.throws(() => importMedia(wp, dangling, { alt: 'a' }), code('EFILE'));
  assert.equal(calls.length, 1);
});

test('PHP-reported errors become typed errors, including the new id on meta failure', () => {
  const svg = path.join(dir, 'a.svg'); fs.writeFileSync(svg, '<svg/>');
  let r = fakeWp('{"error":{"code":"ETYPE","message":"Sorry, you are not allowed to upload this file type."}}\n');
  assert.throws(() => importMedia(r.wp, svg, { alt: 'a' }), (e) => e.code === 'ETYPE' && /SVG uploads are disabled on this site; convert to PNG or inline the SVG in the template/.test(e.message));
  r = fakeWp('{"error":{"code":"EMETA","message":"alt update failed","id":42}}\n');
  assert.throws(() => importMedia(r.wp, png, { alt: 'a' }), (e) => e.code === 'EMETA' && e.id === 42 && /42/.test(e.message));
  r = fakeWp('{"error":{"code":"ESIDELOAD","message":"disk full"}}\n');
  assert.throws(() => importMedia(r.wp, png, { alt: 'a' }), (e) => e.code === 'ESIDELOAD' && /disk full/.test(e.message));
});

test('imageAttr has the Proto-Blocks image field shape', () => {
  assert.deepEqual(imageAttr({ id: 1, url: 'u', alt: 'a', mime: 'image/png' }), { id: 1, url: 'u', alt: 'a', caption: '', size: 'full' });
});

test('parseFlags handles missing values: --alt without value is kept as missing, unknown/stray args rejected', () => {
  assert.deepEqual(parseFlags(['--alt', 'Logo', '--title', 'T']), { alt: 'Logo', title: 'T' });
  assert.deepEqual(parseFlags(['--alt', '']), { alt: '' });
  assert.deepEqual(parseFlags(['--alt']), { alt: null });
  assert.deepEqual(parseFlags(['--alt', '--title', 'T']), { alt: null, title: 'T' });
  assert.deepEqual(parseFlags(['--alt=Logo']), { alt: 'Logo' });
  assert.equal(parseFlags(['--bogus', 'x']), null);
  assert.equal(parseFlags(['stray']), null);
});

test('title must be a string of at most 200 characters', () => {
  const { wp, calls } = fakeWp();
  assert.throws(() => importMedia(wp, png, { alt: 'a', title: 5 }), code('EUSAGE'));
  assert.throws(() => importMedia(wp, png, { alt: 'a', title: null }), code('EUSAGE'));
  assert.throws(() => importMedia(wp, png, { alt: 'a', title: 't'.repeat(201) }), code('ETITLE'));
  assert.equal(calls.length, 0);
  importMedia(wp, png, { alt: 'a', title: 't'.repeat(200) });
  importMedia(wp, png, { alt: 'a' });
  assert.equal(calls.length, 2);
});

test('createWp extraArgs are global WP-CLI flags placed before the command; absent by default', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
  createWp({ wp: 'wp', mode: 'native', publicPath: '/s' }, { exec, extraArgs: ['--exec=1;'] }).run(['option', 'get', 'x']);
  createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec, extraArgs: ['--exec=1;'] }).run(['option', 'get', 'x']);
  assert.deepEqual(calls[0], ['--path=/s', '--exec=1;', 'option', 'get', 'x']);
  assert.deepEqual(calls[1], ['--exec=1;', 'option', 'get', 'x']);
});
