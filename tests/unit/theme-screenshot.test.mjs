import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { themeScreenshot, screenshotFrame, SCREENSHOT_SIZE } from '../../skills/protoblocks-site-builder/scripts/lib/theme-screenshot.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const SCRIPT = new URL('../../skills/protoblocks-site-builder/scripts/lib/theme-screenshot.mjs', import.meta.url).pathname;

// A fork (marker in style.css) with a build state and, optionally, a page with frames.
function fork({ frames } = {}) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-shot-'));
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nTheme Name: Acme\nProto Fork: proto-blocks-theme@1.0.0\n*/');
  initState(theme, { url: 'http://a.local', path: '/x', theme: { slug: 'acme' } });
  if (frames) {
    const list = frames.map((f) => { const image = path.join(theme, `${f.breakpoint}${f.ext ?? '.png'}`); if (f.exists !== false) fs.writeFileSync(image, 'x'); return { breakpoint: f.breakpoint, width: 1440, scale: 1, image }; });
    updateState(theme, (s) => { s.pages.push({ slug: 'other', status: 'planning', sections: [], design: { frames: [] } }); s.pages.push({ slug: 'home', status: 'planning', sections: [], design: { frames: list } }); });
  }
  return theme;
}

test('screenshotFrame finds the desktop frame by page slug; ENOPAGE / EINPUT / EIMAGE otherwise', () => {
  const t = fork({ frames: [{ breakpoint: 'mobile' }, { breakpoint: 'desktop', ext: '.jpg' }] });
  const f = screenshotFrame(loadState(t), 'home');
  assert.equal(f.breakpoint, 'desktop');
  assert.ok(f.image.endsWith('desktop.jpg'), 'JPEG frames are accepted');
  assert.throws(() => screenshotFrame(loadState(t), 'nope'), (e) => e.code === 'ENOPAGE');
  assert.throws(() => screenshotFrame(loadState(t), 'other'), (e) => e.code === 'EINPUT' && /no desktop frame/.test(e.message));
  assert.throws(() => screenshotFrame(loadState(t), 'Home Page'), (e) => e.code === 'EINPUT');
  const missing = fork({ frames: [{ breakpoint: 'desktop', exists: false }] });
  assert.throws(() => screenshotFrame(loadState(missing), 'home'), (e) => e.code === 'EIMAGE' && /missing on disk/.test(e.message));
  const webp = fork({ frames: [{ breakpoint: 'desktop', ext: '.webp' }] });
  assert.throws(() => screenshotFrame(loadState(webp), 'home'), (e) => e.code === 'EIMAGE' && /PNG or JPEG/.test(e.message));
});

test('themeScreenshot writes <theme>/screenshot.png at 1200x900 from the desktop frame and records site.theme.screenshot', async () => {
  const t = fork({ frames: [{ breakpoint: 'desktop' }] });
  const calls = [];
  const cropTopToSize = async (file, out, size) => { calls.push([file, out, size]); fs.writeFileSync(out, 'png'); return { out, source: { width: 1440, height: 2000 }, crop: { width: 1440, height: 1080 }, ...size }; };
  const r = await themeScreenshot(t, 'home', { cropTopToSize });
  assert.deepEqual(SCREENSHOT_SIZE, { width: 1200, height: 900 });
  assert.deepEqual(calls, [[path.join(t, 'desktop.png'), path.join(t, 'screenshot.png'), { width: 1200, height: 900 }]]);
  assert.deepEqual([r.out, r.page, r.frame, r.source, r.crop, r.width, r.height], [path.join(t, 'screenshot.png'), 'home', path.join(t, 'desktop.png'), { width: 1440, height: 2000 }, { width: 1440, height: 1080 }, 1200, 900]);
  assert.match(r.writtenAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  const shot = loadState(t).site.theme.screenshot;
  assert.deepEqual(shot, { page: 'home', source: 'frame', writtenAt: r.writtenAt });
  assert.equal(loadState(t).site.theme.slug, 'acme', 'the rest of site.theme is kept');
  // Nothing is recorded when the crop fails.
  const bad = fork({ frames: [{ breakpoint: 'desktop' }] });
  await assert.rejects(themeScreenshot(bad, 'home', { cropTopToSize: async () => { throw Object.assign(new Error('boom'), { code: 'EBOOM' }); } }), (e) => e.code === 'EBOOM');
  assert.equal(loadState(bad).site.theme.screenshot, undefined);
});

test('themeScreenshot refuses a folder that is not a fork (ENOTFORK) before reading anything', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-shot-foreign-'));
  await assert.rejects(themeScreenshot(dir, 'home', { cropTopToSize: async () => { throw new Error('must not run'); } }), (e) => e.code === 'ENOTFORK');
});

test('CLI: bad usage exits 64; a missing page prints [ENOPAGE] and exits 1', () => {
  const t = fork({ frames: [{ breakpoint: 'desktop' }] });
  const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
  for (const argv of [[], [t], [t, 'home', 'extra'], ['--root', t], [t, '--page']]) {
    const r = run(...argv);
    assert.equal(r.status, 64, JSON.stringify(argv));
    assert.match(r.stderr, /Usage: node theme-screenshot\.mjs <themeDir> <page>/);
  }
  const r = run(t, 'nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[ENOPAGE\]/);
});
