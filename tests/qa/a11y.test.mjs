import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { qtest, serveFixtures, QA_DIR } from './helpers.mjs';

const load = async () => ({
  ...(await import(path.join(QA_DIR, 'a11y.mjs'))),
  ...(await import(path.join(QA_DIR, 'browser.mjs'))),
});
// Async: the fixture server runs in this process, so a synchronous spawn would leave it unable to answer.
const cli = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(QA_DIR, 'a11y.mjs'), ...args], { encoding: 'utf8' }, (e, stdout, stderr) => resolve({ status: e ? e.code : 0, stdout, stderr }));
});
const html = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;

// Each pattern fixture: the ids it must produce (in order) and nothing else.
const PATTERNS = {
  '/nested-nav.html': [html('<header><nav aria-label="A"><nav aria-label="B"><a href="/a">a</a><a href="/b">b</a></nav></nav></header>'), ['nested-nav']],
  '/small-nav.html': [html('<footer><nav aria-label="Legal"><a href="/p">Privacy</a></nav><nav aria-label="Footer"><div role="group"><a href="/a">a</a></div><div role="group"><a href="/b">b</a></div></nav></footer>'), ['nav-too-few-links']],
  '/tabs-owns.html': [html('<main><div><button role="tab" id="t1">One</button></div><div role="tablist" aria-owns="t1"><div role="tabpanel" aria-labelledby="t1">p</div></div><div role="tabpanel" aria-labelledby="nope">q</div></main>'), ['tab-outside-tablist', 'tabpanel-unlabelled', 'tabpanel-in-tablist']],
  '/tabs-ok.html': [html('<main><div role="tablist"><span><button role="tab" id="t1">One</button></span></div><div role="tabpanel" aria-labelledby="t1">p</div></main>'), []],
  '/anchors.html': [html('<main><a>no href</a><a role="button" tabindex="0">toggle</a><a role="button">half</a><a href="/x">ok</a></main>'), ['anchor-without-href']],
  '/role-img.html': [html('<main><div role="img" aria-label="x"><svg></svg></div><svg role="img" aria-label="ok"><rect/></svg><span role="img" aria-label="star"></span><span role="img"></span><img role="img" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main>'), ['role-img-misplaced']],
  '/mains.html': [html('<main>a</main><div role="main">b</div><main hidden>c</main>'), ['multiple-main']],
  '/headings.html': [html('<header><h1>Site</h1></header><main><h3>skip</h3><h4>ok</h4><h2>up is fine</h2><div style="display:none"><h6>hidden</h6></div><div role="heading" aria-level="5">aria</div></main>'), ['heading-skip', 'heading-skip']],
  '/adminbar.html': [html('<div id="wpadminbar"><a>x</a><nav><a href="/a">a</a></nav></div><main><h1>t</h1></main>'), []],
};

qtest('patternChecks flags each widget pattern once per rule (heading skips once per pair) and passes the correct markup', async () => {
  const { patternChecks, launchBrowser, openPage } = await load();
  const virtual = Object.fromEntries(Object.entries(PATTERNS).map(([p, [body]]) => [p, { type: 'text/html', body }]));
  const srv = await serveFixtures(virtual);
  const browser = await launchBrowser();
  try {
    for (const [p, [, ids]] of Object.entries(PATTERNS)) {
      const { page, context } = await openPage(browser, { url: `${srv.url}${p}`, width: 800 });
      try {
        const r = await patternChecks(page);
        assert.deepEqual(r.map((x) => x.id), ids, `${p}: ${JSON.stringify(r)}`);
        for (const x of r) {
          assert.equal(x.impact, 'serious');
          assert.equal(x.helpUrl, null);
          assert.ok(x.help.length > 10);
          for (const n of x.nodes) { assert.equal(n.target.length, 1); assert.ok(n.html.length <= 120); }
        }
        if (p === '/headings.html') {
          assert.deepEqual(r.map((x) => x.nodes.map((n) => n.html)), [['<h1>Site</h1>', '<h3>skip</h3>'], ['<h2>up is fine</h2>', '<div role="heading" aria-level="5">aria</div>']]);
          assert.match(r[0].help, /h1 is followed by h3/);
        }
        if (p === '/anchors.html') assert.deepEqual(r[0].nodes.map((n) => n.html), ['<a>no href</a>', '<a role="button">half</a>']);
        if (p === '/role-img.html') assert.deepEqual(r[0].nodes.map((n) => n.html.slice(0, 14)), ['<div role="img', '<span role="im']);
        if (p === '/small-nav.html') assert.deepEqual(r[0].nodes.map((n) => n.target[0]), ['body > footer > nav:nth-of-type(1)'], 'links inside role=group count for their nav');
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await srv.close(); }
});

qtest('runAxe tags every node with its scope; a region node on core\'s skip link is info while a real region failure blocks', async () => {
  const { runAxe, A11Y_TAGS, launchBrowser, openPage } = await load();
  // The skip link's target is missing, the one way axe 4.13 reports `region` on it.
  const body = html('<a id="wp-skip-link" class="skip-link" href="#wp--skip-link--target">Skip to content</a><header><a href="/">Home</a></header><main><h1>t</h1><section id="pb-s1"><p>x</p></section></main><div id="stray">Outside every landmark</div>');
  const srv = await serveFixtures({ '/skip.html': { type: 'text/html', body } });
  const browser = await launchBrowser();
  try {
    const { page, context } = await openPage(browser, { url: `${srv.url}/skip.html`, width: 1000 });
    try {
      const r = await runAxe(page);
      assert.deepEqual(r.tagsUsed, A11Y_TAGS);
      const info = r.other.filter((v) => v.id === 'region');
      assert.deepEqual(info.map((v) => [v.impact, v.nodes.map((n) => n.target[0])]), [['info', ['#wp-skip-link']]]);
      // The stray div is outside the page scopes, so it is not held against the page either.
      assert.ok(!r.blocking.some((v) => v.id === 'region'), JSON.stringify(r.blocking));
    } finally { await context.close(); }
  } finally { await browser.close(); await srv.close(); }
});

qtest('checkSectionA11y and `a11y.mjs check-section` report only what is inside the section anchor', async () => {
  const { checkSectionA11y } = await load();
  const srv = await serveFixtures();
  try {
    const url = `${srv.url}/a11y-oflex-bad.html`;
    const s3 = await checkSectionA11y({ url, anchor: 'pb-s3', width: 390 });
    assert.deepEqual([s3.url, s3.anchor, s3.width, s3.pass], [url, 'pb-s3', 390, false]);
    assert.deepEqual(s3.blocking.map((v) => v.id), ['target-size']);
    assert.ok(s3.blocking[0].nodes.every((n) => n.inScope === true && /Slide/.test(n.html)), JSON.stringify(s3.blocking));
    assert.deepEqual(s3.patterns, []);
    assert.deepEqual(s3.other, []);
    const s4 = await checkSectionA11y({ url, anchor: 'pb-s4' });
    assert.deepEqual(s4.patterns.map((p) => p.id), ['tab-outside-tablist', 'tabpanel-in-tablist'], 'the page-wide heading skip and header/footer navs are not the section\'s');
    assert.ok(!s4.blocking.some((v) => ['landmark-unique', 'heading-order', 'target-size'].includes(v.id)), JSON.stringify(s4.blocking.map((v) => v.id)));
    const ok = await checkSectionA11y({ url: `${srv.url}/a11y-oflex-fixed.html`, anchor: 'pb-s4' });
    assert.equal(ok.pass, true, JSON.stringify(ok));
    await assert.rejects(checkSectionA11y({ url, anchor: 'pb-s9' }), (e) => e.code === 'EANCHOR' && /#pb-s9 is not on the page/.test(e.message));
    // The CLI runs the same check and exits 1 on a failure, with the JSON on stdout.
    const bad = await cli('check-section', url, 'pb-s3', '--width', '390');
    assert.equal(bad.status, 1, bad.stderr);
    const j = JSON.parse(bad.stdout);
    assert.deepEqual([j.anchor, j.width, j.pass, j.blocking.map((v) => v.id)], ['pb-s3', 390, false, ['target-size']]);
    const pass = await cli('check-section', `${srv.url}/a11y-oflex-fixed.html`, 'pb-s3');
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.equal(JSON.parse(pass.stdout).width, 1440);
  } finally { await srv.close(); }
});

qtest('afterNavigation: stale aria-current after a Taxi swap fails with the missing and stale links; the theme\'s syncNavState passes', async () => {
  const { afterNavigation, launchBrowser, openPage } = await load();
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const run = (q = '') => afterNavigation({ browser, openPage, url: `${srv.url}/a11y-taxi.html${q}`, width: 1200 });
    const stale = await run();
    assert.deepEqual([stale.skipped, stale.from, stale.to, stale.via, stale.pass], [false, `${srv.url}/a11y-taxi.html`, `${srv.url}/a11y-taxi-about.html`, 'taxi', false]);
    assert.deepEqual(stale.ariaCurrent, {
      pass: false,
      missing: ['#pb-header > nav > ul > li:nth-of-type(2) > a', '#footer-menu > li:nth-of-type(2) > a'],
      stale: ['#pb-header > nav > ul > li:nth-of-type(1) > a', '#footer-menu > li:nth-of-type(1) > a'],
      hash: [],
    });
    assert.deepEqual([stale.blocking, stale.patterns], [[], []]);
    const synced = await run('?sync=1');
    assert.deepEqual(synced.ariaCurrent, { pass: true, missing: [], stale: [], hash: [] }, 'the footer #cookie-settings link is never required to be current');
    assert.equal(synced.pass, true, JSON.stringify(synced));
    // A hash link the theme marks current (it resolves to the current path) fails on its own.
    const hash = await run('?sync=1&hashbug=1');
    assert.deepEqual([hash.ariaCurrent.missing, hash.ariaCurrent.stale, hash.ariaCurrent.hash, hash.pass], [[], [], ['#cookie-settings'], false]);
    const noReady = await run('?noready=1');
    assert.deepEqual([noReady.skipped, noReady.pass, noReady.ariaCurrent], [false, false, null]);
    assert.match(noReady.error, /proto:page-ready was not dispatched within \d+ms of clicking .*a11y-taxi-about\.html/);
  } finally { await browser.close(); await srv.close(); }
});

qtest('afterNavigation skips with a warning without [data-taxi], or when the header links only to the current page', async () => {
  const { afterNavigation, NO_TAXI_WARNING, NO_LINK_WARNING, launchBrowser, openPage } = await load();
  const self = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><div data-taxi><header><a href="/self.html">Home</a><a href="#top">Top</a><a href="mailto:a@b.c">Mail</a><a href="https://example.com/">Out</a></header><div data-taxi-view><main><h1>t</h1></main></div></div></body></html>';
  const srv = await serveFixtures({ '/self.html': { type: 'text/html', body: self } });
  const browser = await launchBrowser();
  try {
    assert.deepEqual(await afterNavigation({ browser, openPage, url: `${srv.url}/a11y-oflex-fixed.html`, width: 1200 }), { skipped: true, warning: NO_TAXI_WARNING });
    assert.deepEqual(await afterNavigation({ browser, openPage, url: `${srv.url}/self.html`, width: 1200 }), { skipped: true, warning: NO_LINK_WARNING });
  } finally { await browser.close(); await srv.close(); }
});

qtest('a11yForPage merges axe over every width (target-size at mobile too), runs the patterns once, and the post-navigation pass', async () => {
  const { a11yForPage, launchBrowser, openPage } = await load();
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const diagnostics = {};
    const r = await a11yForPage({ browser, openPage, url: `${srv.url}/a11y-oflex-bad.html`, widths: [{ name: 'desktop', width: 1440 }, { name: 'mobile', width: 390 }, { name: 'dup', width: 390 }], diagnostics });
    assert.deepEqual(r.byViewport.map((v) => [v.name, v.width]), [['desktop', 1440], ['mobile', 390]]);
    assert.ok(r.byViewport[1].blocking.includes('target-size'));
    assert.deepEqual(r.blocking.find((v) => v.id === 'target-size').viewports, ['desktop', 'mobile']);
    assert.ok(r.patterns.length > 0);
    assert.equal(diagnostics.status, 200);
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.equal(r.afterNavigation.skipped, true);
    const taxi = await a11yForPage({ browser, openPage, url: `${srv.url}/a11y-taxi.html`, widths: [1200] });
    assert.deepEqual([taxi.byViewport[0].name, taxi.afterNavigation.skipped, taxi.afterNavigation.pass], ['1200', false, false]);
    const off = await a11yForPage({ browser, openPage, url: `${srv.url}/a11y-taxi.html`, widths: [1200], navigation: false });
    assert.equal(off.afterNavigation, null);
    // axe failures never throw: they set `error`.
    const broken = await a11yForPage({ browser, openPage: async () => { throw new Error('no-page'); }, url: `${srv.url}/a11y-taxi.html`, widths: [1200] });
    assert.match(broken.error, /no-page/);
  } finally { await browser.close(); await srv.close(); }
});
