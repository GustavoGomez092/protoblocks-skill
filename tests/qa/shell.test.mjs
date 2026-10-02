// pb-shell.css (the managed theme asset) against a page shaped like a proto-blocks-theme fork after `move-parts`: the
// theme's padded, 1440px-capped header/footer shell, the template parts holding #pb-header / #pb-footer, and WordPress
// core's global styles (root blockGap) when they are on. Each assertion is one rule of pb-shell.css; the control run
// without the stylesheet proves the fixture reproduces the problem the rule fixes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qtest, serveFixtures, QA_DIR } from './helpers.mjs';

const SHELL_CSS = path.join(QA_DIR, '..', 'theme-assets', 'assets', 'css', 'pb-shell.css');

// globalStyles: WordPress core's global-styles rules (absent when Proto-Blocks' "Disable WP Global Styles" is on).
const page = ({ shell, globalStyles }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>shell</title>
${globalStyles ? '<style id="global-styles-inline-css">:where(body){margin:0}:where(.wp-site-blocks) > *{margin-block-start:24px;margin-block-end:0}:where(.wp-site-blocks) > :first-child{margin-block-start:0}:where(.wp-site-blocks) > :last-child{margin-block-end:0}</style>' : ''}
<style id="theme-style-css">
.wp-site-blocks { display: flex; flex-direction: column; min-height: 100vh; }
.wp-site-blocks > header, .wp-site-blocks > footer, .wp-site-blocks main {
  box-sizing: border-box; width: 100%; max-width: 1440px; margin-inline: auto; padding-inline: clamp(1rem, 4vw, 2.5rem);
}
</style>
${shell ? '<link rel="stylesheet" id="pb-shell-css" href="/pb-shell.css">' : ''}
</head><body>
<div class="wp-site-blocks">
<header class="wp-block-template-part"><header id="pb-header" style="display:block;height:80px;background:#0f172a"></header></header>
<div data-taxi><div data-taxi-view><main class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding:0"><section id="pb-s2" style="height:300px;background:#fef3c7"></section></main></div></div>
<footer class="wp-block-template-part"><footer id="pb-footer" style="display:block;height:120px;background:#0f172a"></footer></footer>
</div>
</body></html>`;

async function measure(width, variant) {
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
  const srv = await serveFixtures({
    '/shell.html': { type: 'text/html', body: page(variant) },
    '/pb-shell.css': { type: 'text/css', body: fs.readFileSync(SHELL_CSS, 'utf8') },
  });
  const browser = await launchBrowser();
  try {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    await p.goto(`${srv.url}/shell.html`, { waitUntil: 'load' });
    return await p.evaluate(() => {
      const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, width: r.width, top: r.top + scrollY, bottom: r.bottom + scrollY }; };
      return {
        viewport: document.documentElement.clientWidth,
        bodyMargin: getComputedStyle(document.body).marginTop,
        header: box('#pb-header'),
        main: box('main'),
        footer: box('#pb-footer'),
      };
    });
  } finally {
    await browser.close();
    await srv.close();
  }
}

// Rule 1 (`:where(body){margin:0}`): no 8px body margin when WordPress' global styles are off.
qtest('pb-shell.css: the body has no margin when WP global styles are disabled', async () => {
  const off = await measure(1440, { shell: false, globalStyles: false });
  assert.equal(off.bodyMargin, '8px', 'control: without pb-shell.css the browser default body margin applies');
  const on = await measure(1440, { shell: true, globalStyles: false });
  assert.equal(on.bodyMargin, '0px');
  assert.equal(on.main.left, 0, 'the content starts at the viewport edge');
});

// Rule 2: the template part holding #pb-header / #pb-footer is not padded or capped by the theme shell.
qtest('pb-shell.css: header and footer parts are full-bleed (no theme gutters, no 1440px cap)', async () => {
  for (const width of [1440, 1680]) {
    const off = await measure(width, { shell: false, globalStyles: true });
    assert.ok(off.header.width < off.viewport, `control at ${width}: the padded part shell shrinks the header (${off.header.width} < ${off.viewport})`);
    const on = await measure(width, { shell: true, globalStyles: true });
    for (const k of ['header', 'footer']) {
      assert.equal(on[k].width, on.viewport, `${k} at ${width}: ${JSON.stringify(on[k])}`);
      assert.equal(on[k].left, 0, `${k} at ${width}`);
    }
  }
});

// Rule 3: no root blockGap margin between the parts and the page content when WordPress' global styles are on.
qtest('pb-shell.css: no blockGap margin between the header part, main and the footer part', async () => {
  const off = await measure(1440, { shell: false, globalStyles: true });
  assert.equal(off.main.top - off.header.bottom, 24, 'control: WordPress core adds the 24px root blockGap');
  for (const globalStyles of [true, false]) {
    const on = await measure(1440, { shell: true, globalStyles });
    assert.equal(on.main.top, on.header.bottom, `main starts where the header ends (global styles ${globalStyles})`);
    assert.equal(on.footer.top, on.main.bottom, `the footer starts where main ends (global styles ${globalStyles})`);
  }
});
