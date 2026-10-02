import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSlug, assertSlug, SLUG_RE } from '../../skills/protoblocks-site-builder/scripts/lib/slugs.mjs';
import { addFrame, ensurePage, cropSections, framesFromUrl } from '../../skills/protoblocks-site-builder/scripts/lib/intake.mjs';
import { buildCheckInput } from '../../skills/protoblocks-site-builder/scripts/lib/qa-input.mjs';
import { recordUse } from '../../skills/protoblocks-site-builder/scripts/lib/library.mjs';
import { pageSpecFromState } from '../../skills/protoblocks-site-builder/scripts/lib/page.mjs';
import { initState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const BAD = ['../../x', 'About_Us', 'About', '', '-a', 'a-', 'a--b', 'a/b', '.hidden', 'a b', undefined, null, 5];
const GOOD = ['home', 'about-us', 'a1', '2026-plans'];

test('one slug rule: lowercase letters/digits separated by single dashes', () => {
  assert.equal(String(SLUG_RE), String(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));
  for (const s of GOOD) assert.ok(isSlug(s), s);
  for (const s of BAD) assert.ok(!isSlug(s), String(s));
  assert.throws(() => assertSlug('About_Us', 'page slug'), (e) => e.code === 'EINPUT' && /About_Us/.test(e.message) && /page slug/.test(e.message));
  assert.throws(() => assertSlug('x/y', 'block', 'EBLOCK'), (e) => e.code === 'EBLOCK');
  assert.equal(assertSlug('home', 'page slug'), 'home');
});

function png(file) {
  // 1440x1 PNG header is enough for imageWidth; addFrame must reject the slug before reading anything anyway
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(8); ihdr.writeUInt32BE(1440, 0); ihdr.writeUInt32BE(1, 4);
  fs.writeFileSync(file, Buffer.concat([sig, Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), ihdr, Buffer.alloc(9)]));
  return file;
}

test('addFrame rejects an unsafe page slug or unknown breakpoint before any file write (EINPUT)', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-slug-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  const src = png(path.join(theme, 'd.png'));
  const before = fs.readFileSync(path.join(theme, '.protoblocks', 'build.json'), 'utf8');
  for (const slug of ['../../x', 'About_Us']) {
    assert.throws(() => addFrame(theme, slug, 'desktop', src), (e) => e.code === 'EINPUT', slug);
  }
  for (const bp of ['../../x', 'watch', '__proto__', 'constructor']) {
    assert.throws(() => addFrame(theme, 'home', bp, src, { width: 1440 }), (e) => e.code === 'EINPUT', bp);
  }
  assert.equal(fs.existsSync(path.join(theme, '.protoblocks', 'artifacts')), false, 'nothing copied');
  assert.equal(fs.existsSync(path.join(theme, 'x')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(theme), 'x')), false);
  assert.equal(fs.readFileSync(path.join(theme, '.protoblocks', 'build.json'), 'utf8'), before, 'state untouched');
  assert.equal(loadState(theme).pages.length, 0);
});

test('ensurePage rejects unsafe slugs (EINPUT)', () => {
  for (const slug of ['../../x', 'About_Us']) assert.throws(() => ensurePage({ pages: [] }, slug), (e) => e.code === 'EINPUT', slug);
});

test('qa-input, library and page.mjs share the same rule', () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-slug-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  const st = loadState(theme);
  for (const slug of ['About_Us', 'a--b', 'a-']) {
    assert.throws(() => buildCheckInput(st, theme, slug, 1), (e) => e.code === 'EINPUT', `qa-input ${slug}`);
    assert.throws(() => recordUse(theme, 'hero', slug), (e) => e.code === 'ESLUG', `library page ${slug}`);
    assert.throws(() => recordUse(theme, slug.toLowerCase(), 'home'), (e) => e.code === 'EBLOCK', `library block ${slug}`);
    assert.throws(() => pageSpecFromState({ pages: [{ slug, sections: [] }] }, slug), (e) => e.code === 'EINPUT', `page ${slug}`);
  }
});

test('cropSections and framesFromUrl reject unsafe slugs before any write (EINPUT)', async () => {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-slug-'));
  initState(theme, { url: 'http://a.local', path: '/x' });
  for (const slug of ['../../x', 'About_Us']) {
    await assert.rejects(() => cropSections(theme, slug, { desktop: [{ n: 1, y0: 0, y1: 5 }] }), (e) => e.code === 'EINPUT', slug);
    await assert.rejects(() => framesFromUrl(theme, slug, 'http://a.local', [1440]), (e) => e.code === 'EINPUT', slug);
  }
  assert.equal(fs.existsSync(path.join(theme, '.protoblocks', 'artifacts')), false);
});
