import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, makeImage, QA_DIR } from './helpers.mjs';

const load = async () => ({
  ...(await import(path.join(QA_DIR, 'page-qa.mjs'))),
  ...(await import(path.join(QA_DIR, 'shoot.mjs'))),
  ...(await import(path.join(QA_DIR, 'image.mjs'))),
});

// The design a page is compared against: its own whole-document render.
const designOf = async (shoot, url, d, width = 1440, scale = 1) => (await shoot({ url, selector: 'body', width, scale, out: path.join(d, `design-${width}-${scale}.png`) })).out;

qtest('pageQa passes a page against its own full-page render and reports a11y', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const design = await designOf(shoot, url, d);
    const r = await pageQa({ url, frames: [{ breakpoint: 'desktop', width: 1440, scale: 1, image: design }], outDir: path.join(d, 'out') });
    assert.equal(r.breakpoints[0].pass, true, JSON.stringify(r.breakpoints));
    assert.equal(r.breakpoints[0].status, 200);
    assert.equal(r.breakpoints[0].scaleUsed, 1);
    assert.ok(Array.isArray(r.a11y.blocking));
    assert.equal(r.a11y.error, undefined);
    assert.equal(r.pass, true, JSON.stringify(r));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'out', 'page-qa.json'), 'utf8')).pass, true);
  } finally { await srv.close(); }
});

qtest('pageQa shoots the whole document: the body shot is the full document height, header and footer included', async () => {
  const { pageQa, loadRaw } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const design = await makeImage({ width: 1440, height: 9000 }, path.join(d, 'blank.png'));
    const r = await pageQa({ url: `${srv.url}/tall.html`, frames: [{ breakpoint: 'desktop', width: 1440, scale: 1, image: design }], outDir: path.join(d, 'out') });
    assert.equal((await loadRaw(path.join(d, 'out', 'desktop-page.png'))).height, 9000);
    assert.equal(r.breakpoints[0].heightDelta, 0);
  } finally { await srv.close(); }
});

qtest('pageQa lowers an oversized scale to fit the 16384px surface instead of failing (9000px page at scale 2)', async () => {
  const { pageQa, shoot, loadRaw } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/tall.html`;
    const design = await designOf(shoot, url, d, 1440, 1);
    const r = await pageQa({ url, frames: [{ breakpoint: 'desktop', width: 1440, scale: 2, image: design }], outDir: path.join(d, 'out') });
    const b = r.breakpoints[0];
    assert.equal(b.scaleUsed, 1);
    assert.equal(b.pass, true, JSON.stringify(b));
    assert.equal((await loadRaw(path.join(d, 'out', 'desktop-page.png'))).height, 9000);
    assert.deepEqual(r.warnings, []);
  } finally { await srv.close(); }
});

qtest('pageQa keeps a scale that fits (400px-wide shot at scale 2 stays at 2)', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const design = await designOf(shoot, url, d, 400, 2);
    const r = await pageQa({ url, frames: [{ breakpoint: 'mobile', width: 400, scale: 2, image: design }], outDir: path.join(d, 'out') });
    assert.equal(r.breakpoints[0].scaleUsed, 2);
    assert.equal(r.breakpoints[0].pass, true, JSON.stringify(r.breakpoints));
  } finally { await srv.close(); }
});

qtest('pageQa blocks serious axe violations inside main but ignores those outside the page scopes', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const run = async (name) => {
      const url = `${srv.url}/${name}.html`;
      const design = await designOf(shoot, url, d, 1000);
      return pageQa({ url, frames: [{ breakpoint: 'desktop', width: 1000, scale: 1, image: design }], outDir: path.join(d, name) });
    };
    const inMain = await run('a11y-main');
    assert.equal(inMain.breakpoints[0].pass, true);
    assert.ok(inMain.a11y.blocking.some((v) => v.id === 'image-alt'), JSON.stringify(inMain.a11y.blocking.map((v) => v.id)));
    assert.ok(!inMain.a11y.blocking.some((v) => v.id === 'link-name'), 'violation outside the scopes must not count');
    assert.equal(inMain.pass, false);
    const outside = await run('a11y-outside');
    assert.deepEqual(outside.a11y.blocking, [], JSON.stringify(outside.a11y.blocking.map((v) => v.id)));
    assert.equal(outside.pass, true, JSON.stringify(outside));
  } finally { await srv.close(); }
});

qtest('pageQa fails a broken image anywhere on the page, even outside any section', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/footer-broken-img.html`;
    const design = await designOf(shoot, url, d, 1000);
    const r = await pageQa({ url, frames: [{ breakpoint: 'desktop', width: 1000, scale: 1, image: design }], outDir: path.join(d, 'out') });
    assert.equal(r.breakpoints[0].mismatch, 0);
    assert.deepEqual(r.breakpoints[0].imageErrors.map((u) => u.endsWith('/does-not-exist.png')), [true]);
    assert.equal(r.breakpoints[0].pass, false);
    assert.equal(r.pass, false);
  } finally { await srv.close(); }
});

qtest('pageQa fails a breakpoint whose page answers HTTP 404 and records the status', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/no-such-page.html`;
    const design = await designOf(shoot, url, d, 800);
    const r = await pageQa({ url, frames: [{ breakpoint: 'desktop', width: 800, scale: 1, image: design }], outDir: path.join(d, 'out') });
    assert.equal(r.breakpoints[0].mismatch, 0);
    assert.equal(r.breakpoints[0].status, 404);
    assert.equal(r.breakpoints[0].pass, false);
    assert.equal(r.pass, false);
  } finally { await srv.close(); }
});

qtest('pageQa fails a breakpoint whose diff is fully masked', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const design = await designOf(shoot, url, d);
    const r = await pageQa({ url, frames: [{ breakpoint: 'desktop', width: 1440, scale: 1, image: design, masks: [{ x: 0, y: 0, w: 1440, h: 5000 }] }], qa: { pageMismatchMax: 1 }, outDir: path.join(d, 'out') });
    assert.equal(r.breakpoints[0].fullyMasked, true);
    assert.equal(r.breakpoints[0].pass, false);
    assert.equal(r.pass, false);
  } finally { await srv.close(); }
});

qtest('pageQa fails on page script errors (page and axe runs)', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/throws.html`;
    const design = await designOf(shoot, url, d, 800);
    const r = await pageQa({ url, frames: [{ breakpoint: 'desktop', width: 800, scale: 1, image: design }], outDir: path.join(d, 'out') });
    assert.ok(r.pageErrors.some((m) => m.includes('fixture-boom')));
    assert.equal(r.pass, false);
  } finally { await srv.close(); }
});

qtest('pageQa runs axe on its own page at the first frame width, and an axe failure is recorded without losing the diff results', async () => {
  const { pageQa, shoot } = await load();
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const design = await designOf(shoot, url, d);
    const mobile = await designOf(shoot, url, d, 400);
    const frames = [{ breakpoint: 'desktop', width: 1440, scale: 1, image: design }, { breakpoint: 'mobile', width: 400, scale: 1, image: mobile }];
    const browser = await launchBrowser();
    const widths = [];
    let failAxe = false;
    const orig = browser.newContext.bind(browser);
    // The axe run is the first context opened at the desktop width after the mobile breakpoint has been shot.
    browser.newContext = async (opts) => {
      const w = opts.viewport.width;
      if (failAxe && widths.includes(400) && w === 1440) throw new Error('axe-boom');
      widths.push(w);
      return orig(opts);
    };
    try {
      const ok = await pageQa({ url, frames, outDir: path.join(d, 'ok'), browser });
      assert.equal(ok.pass, true, JSON.stringify(ok));
      assert.equal(widths.at(-1), 1440, `viewport widths in order: ${widths}`);
      failAxe = true;
      widths.length = 0;
      const r = await pageQa({ url, frames, outDir: path.join(d, 'bad'), browser });
      assert.match(r.a11y.error, /axe-boom/);
      assert.equal(r.pass, false);
      assert.equal(r.breakpoints.length, 2);
      assert.equal(r.breakpoints[0].mismatch, 0);
      assert.match(JSON.parse(fs.readFileSync(path.join(d, 'bad', 'page-qa.json'), 'utf8')).a11y.error, /axe-boom/);
    } finally { await browser.close(); }
  } finally { await srv.close(); }
});

qtest('pageQa writes page-qa.json with the error when it throws mid-run', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const design = await designOf(shoot, url, d);
    const corrupt = path.join(d, 'corrupt.png');
    fs.writeFileSync(corrupt, 'not a png');
    await assert.rejects(pageQa({ url, frames: [{ breakpoint: 'desktop', width: 1440, scale: 1, image: design }, { breakpoint: 'mobile', width: 1440, scale: 1, image: corrupt }], outDir: path.join(d, 'out') }));
    const j = JSON.parse(fs.readFileSync(path.join(d, 'out', 'page-qa.json'), 'utf8'));
    assert.equal(j.pass, false);
    assert.ok(j.error);
    assert.equal(j.breakpoints.length, 1);
  } finally { await srv.close(); }
});

qtest('pageQa collects page errors raised during the axe run', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/throws-at-dpr1.html`;
    // The page only throws at device pixel ratio 1: the scale-2 shots stay clean, so the error can only come from the axe page.
    const design = await designOf(shoot, url, d, 400, 2);
    const r = await pageQa({ url, frames: [{ breakpoint: 'mobile', width: 400, scale: 2, image: design }], outDir: path.join(d, 'out') });
    assert.equal(r.breakpoints[0].pass, true, JSON.stringify(r.breakpoints));
    assert.equal(r.a11y.error, undefined);
    assert.ok(r.pageErrors.some((m) => m.includes('dpr1-boom')), JSON.stringify(r.pageErrors));
    assert.equal(r.pass, false);
  } finally { await srv.close(); }
});

qtest('pageQa reports document-level violations (html-has-lang on <html>) as blocking', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/no-lang.html`;
    const design = await designOf(shoot, url, d, 800);
    const r = await pageQa({ url, frames: [{ breakpoint: 'desktop', width: 800, scale: 1, image: design }], outDir: path.join(d, 'out') });
    assert.ok(r.a11y.blocking.some((v) => v.id === 'html-has-lang'), JSON.stringify(r.a11y));
    assert.equal(r.pass, false);
  } finally { await srv.close(); }
});

qtest('pageQa unions design-position masks with masks at the measured render position of each anchor', async () => {
  const { pageQa, shoot } = await load();
  const srv = await serveFixtures();
  try {
    const d = tmpDir();
    const url = `${srv.url}/section.html`;
    const design = await designOf(shoot, url, d);
    // #pb-s2 renders at 400 + 1600 = 2000 CSS px; at 1 design px per CSS px a mask 10px into it lands at y 2010.
    const frame = { breakpoint: 'desktop', width: 1440, scale: 1, image: design, masks: [{ x: 0, y: 5, w: 20, h: 20 }], sectionMasks: [{ anchor: 'pb-s2', masks: [{ x: 0, y: 10, w: 100, h: 20 }] }, { anchor: 'pb-nowhere', masks: [{ x: 0, y: 0, w: 1, h: 1 }] }], pxPerCss: 1 };
    const r = await pageQa({ url, frames: [frame], outDir: path.join(d, 'out'), warnings: ['seeded'] });
    const b = r.breakpoints[0];
    assert.deepEqual(b.masks, [{ x: 0, y: 5, w: 20, h: 20 }, { x: 0, y: 2010, w: 100, h: 20 }]);
    assert.equal(b.masksApplied, 2);
    assert.equal(b.pass, true, JSON.stringify(b));
    assert.equal(r.warnings[0], 'seeded');
    assert.ok(r.warnings.some((w) => /#pb-nowhere is not on the page/.test(w)), JSON.stringify(r.warnings));
  } finally { await srv.close(); }
});

qtest('render-position masks are measured from the top of body (the shot), not of the document', async () => {
  const { pageQa, shoot } = await load();
  const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>offset</title><style>body{margin:48px 0 0;font-family:Arial,sans-serif} section{height:400px} #pb-s1{background:#1e3a8a} #pb-s2{background:#f1f5f9}</style></head><body><main><section id="pb-s1"></section><section id="pb-s2"></section></main></body></html>';
  const srv = await serveFixtures({ '/offset.html': { type: 'text/html', body: page } });
  try {
    const d = tmpDir();
    const url = `${srv.url}/offset.html`;
    const design = (await shoot({ url, selector: 'body', width: 1000, out: path.join(d, 'design.png') })).out;
    const frame = { breakpoint: 'desktop', width: 1000, scale: 1, image: design, sectionMasks: [{ anchor: 'pb-s2', masks: [{ x: 0, y: 10, w: 100, h: 20 }] }], pxPerCss: 1 };
    const r = await pageQa({ url, frames: [frame], outDir: path.join(d, 'out') });
    // #pb-s2 starts 400 px into body (48 px further down the document); the shot is of body.
    assert.deepEqual(r.breakpoints[0].masks, [{ x: 0, y: 410, w: 100, h: 20 }]);
  } finally { await srv.close(); }
});
