import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

const pixel = (raw, x, y) => [...raw.data.subarray((y * raw.width + x) * 4, (y * raw.width + x) * 4 + 3)];
const hasPixel = (raw, rgb) => {
  for (let i = 0; i < raw.width * raw.height; i++) {
    if (raw.data[i * 4] === rgb[0] && raw.data[i * 4 + 1] === rgb[1] && raw.data[i * 4 + 2] === rgb[2]) return true;
  }
  return false;
};

qtest('shoot captures an element at the design width with intro hidden', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const r = await shoot({ url: `${srv.url}/section.html`, selector: '#pb-s1', width: 1440, scale: 1, out: path.join(d, 's1.png') });
    const raw = await loadRaw(r.out);
    assert.equal(raw.width, 1440);
    assert.equal(raw.height, 400);
    assert.deepEqual(pixel(raw, 0, 0), [0x1e, 0x3a, 0x8a], 'top-left is section bg, not the red intro overlay');
    assert.deepEqual(r.pageErrors, []);
  } finally { await srv.close(); }
});

qtest('shoot applies reduced motion by default and honours --motion off switch', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const reduced = await shoot({ url, selector: '#pb-s1', width: 1440, out: path.join(d, 'a.png') });
    assert.ok(hasPixel(await loadRaw(reduced.out), [255, 255, 255]), 'reduced motion: heading fully opaque (pure white pixels)');
    const motion = await shoot({ url, selector: '#pb-s1', width: 1440, reducedMotion: false, out: path.join(d, 'b.png') });
    assert.ok(!hasPixel(await loadRaw(motion.out), [255, 255, 255]), 'motion allowed: heading faded, no pure white');
  } finally { await srv.close(); }
});

qtest('shoot loads lazy images before capture', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const srv = await serveFixtures();
  try {
    const lazy = await shoot({ url: `${srv.url}/section.html`, selector: '#pb-s2', width: 1440, out: path.join(tmpDir(), 's2.png') });
    const lraw = await loadRaw(lazy.out);
    assert.deepEqual(pixel(lraw, Math.round(lraw.width / 2), Math.round(lraw.height / 2)), [0xef, 0x44, 0x44], 'lazy image loaded');
  } finally { await srv.close(); }
});

qtest('openPage scrolls through the page so lazy images are complete before returning', { timeout: 30000 }, async () => {
  const { launchBrowser, openPage } = await import(path.join(QA_DIR, 'browser.mjs'));
  const srv = await serveFixtures();
  const b = await launchBrowser();
  try {
    const { page, context, errors } = await openPage(b, { url: `${srv.url}/lazy-far.html`, width: 1440 });
    const st = await page.evaluate(() => ({ complete: document.images[0].complete, w: document.images[0].naturalWidth, y: window.scrollY }));
    assert.deepEqual(st, { complete: true, w: 200, y: 0 }, 'lazy image decoded, scrolled back to top');
    assert.deepEqual(errors.images, [], 'no incomplete images reported');
    await context.close();
  } finally { await b.close(); await srv.close(); }
});

qtest('shoot does not wait forever on a stalled image and reports it in imageErrors', { timeout: 20000 }, async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const t = Date.now();
    const r = await shoot({ url: `${srv.url}/hang.html`, selector: '#pb-s1', width: 800, out: path.join(tmpDir(), 'h.png') });
    assert.ok(Date.now() - t < 15000, `resolved in ${Date.now() - t}ms`);
    assert.equal(r.imageErrors.length, 1);
    assert.match(r.imageErrors[0], /__hang/);
  } finally { await srv.close(); }
});

qtest('shoot honours deviceScaleFactor', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const { loadRaw } = await import(path.join(QA_DIR, 'image.mjs'));
  const srv = await serveFixtures();
  try {
    const retina = await shoot({ url: `${srv.url}/section.html`, selector: '#pb-s1', width: 1440, scale: 2, out: path.join(tmpDir(), 'r.png') });
    assert.equal((await loadRaw(retina.out)).width, 2880);
  } finally { await srv.close(); }
});

qtest('shoot captures uncaught page errors', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const r = await shoot({ url: `${srv.url}/throws.html`, selector: '#pb-s1', width: 800, out: path.join(tmpDir(), 't.png') });
    assert.equal(r.pageErrors.length, 1);
    assert.match(r.pageErrors[0], /fixture-boom/);
  } finally { await srv.close(); }
});

qtest('shoot throws ENOSELECTOR for a missing anchor', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    await assert.rejects(
      shoot({ url: `${srv.url}/section.html`, selector: '#pb-s9', width: 800, out: path.join(tmpDir(), 'x.png') }),
      (e) => e.code === 'ENOSELECTOR' && /#pb-s9/.test(e.message),
    );
  } finally { await srv.close(); }
});

qtest('shoot closes its context when it throws (injected browser)', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
  const srv = await serveFixtures();
  const b = await launchBrowser();
  try {
    await assert.rejects(shoot({ url: `${srv.url}/section.html`, selector: '#pb-s9', width: 800, out: path.join(tmpDir(), 'x.png'), browser: b }), { code: 'ENOSELECTOR' });
    assert.equal(b.contexts().length, 0, 'context closed after throw');
  } finally { await b.close(); await srv.close(); }
});

qtest('shoot closes the browser it launched, even when it throws (pid-scoped)', async () => {
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  // Playwright's Browser has no public pid; record the chromium child it spawns (--remote-debugging-pipe).
  const cp = createRequire(import.meta.url)('node:child_process');
  const srv = await serveFixtures();
  const realSpawn = cp.spawn;
  let pid;
  cp.spawn = function (cmd, args, ...rest) { const c = realSpawn.call(this, cmd, args, ...rest); if ((args || []).includes('--remote-debugging-pipe')) pid = c.pid; return c; };
  try {
    await assert.rejects(shoot({ url: `${srv.url}/section.html`, selector: '#pb-s9', width: 800, out: path.join(tmpDir(), 'x.png') }), { code: 'ENOSELECTOR' });
  } finally { cp.spawn = realSpawn; await srv.close(); }
  assert.ok(pid, 'recorded the launched browser pid');
  let alive = true;
  for (let i = 0; i < 30 && alive; i++) {
    try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 100)); } catch (e) { alive = e.code !== 'ESRCH'; }
  }
  assert.equal(alive, false, 'launched browser process is gone');
});

qtest('openPage closes its context when navigation fails', async () => {
  const { launchBrowser, openPage } = await import(path.join(QA_DIR, 'browser.mjs'));
  const b = await launchBrowser();
  try {
    await assert.rejects(openPage(b, { url: 'http://127.0.0.1:1/', width: 800 }));
    assert.equal(b.contexts().length, 0, 'context closed after failed goto');
  } finally { await b.close(); }
});
