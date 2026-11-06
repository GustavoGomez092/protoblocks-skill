import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';
import { initState, updateState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const SCRIPT = path.join(QA_DIR, 'site-a11y.mjs');
// Async: the fixture servers run in this process, so a synchronous spawn would leave them unable to answer.
const run = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }, (e, stdout, stderr) => resolve({ status: e ? e.code : 0, stdout, stderr }));
});
const frames = (...widths) => ({ frames: widths.map((w, i) => ({ breakpoint: i ? 'mobile' : 'desktop', width: w, image: 'artifacts/x.png' })) });

function stateWith(siteUrl, pages) {
  const dir = tmpDir('pb-site-a11y-');
  initState(dir, { url: siteUrl, path: '/x' });
  updateState(dir, (s) => { s.pages = pages; });
  return dir;
}

// A site answering every URL with an accessible page and `status` (the fixture server's 404 is a bare "nf").
const anyUrlServer = (status) => {
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><main><h1>Page not found</h1></main></body></html>';
  const server = http.createServer((req, res) => { res.writeHead(status, { 'Content-Type': 'text/html' }); res.end(body); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) })));
};

qtest('site-a11y run: a bad page fails the site with its items, the 404 probe row is present, the json is saved; exit 1', async () => {
  const srv = await serveFixtures();
  try {
    const dir = stateWith(srv.url, [
      { slug: 'bad', url: `${srv.url}/a11y-oflex-bad.html`, status: 'done', sections: [], design: frames(1440, 390) },
      { slug: 'fixed', url: `${srv.url}/a11y-oflex-fixed.html`, status: 'done', sections: [], design: frames(1440) },
      { slug: 'draft', status: 'planning', sections: [] },
    ]);
    const r = await run('run', dir);
    assert.equal(r.status, 1, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.pass, false);
    assert.equal(j.file, path.join(dir, '.protoblocks', 'artifacts', 'site-a11y.json'));
    assert.deepEqual(JSON.parse(fs.readFileSync(j.file, 'utf8')), j);
    assert.deepEqual(j.pages.map((p) => [p.slug, p.status, p.pass]), [['bad', 200, false], ['fixed', 200, true], ['__404__', 404, false]]);
    const [bad, fixed, probe] = j.pages;
    assert.deepEqual(Object.keys(bad), ['slug', 'url', 'status', 'blocking', 'other', 'patterns', 'afterNavigation', 'pass']);
    assert.ok(bad.blocking.some((v) => v.id === 'landmark-unique'));
    assert.deepEqual(bad.blocking.find((v) => v.id === 'target-size').viewports, ['desktop', 'mobile'], 'the union of the frame widths');
    assert.ok(bad.patterns.some((p) => p.id === 'nested-nav'));
    assert.equal(bad.afterNavigation.skipped, true);
    assert.deepEqual([fixed.blocking, fixed.patterns], [[], []]);
    assert.equal(probe.url, `${srv.url}/__pb-404-probe__`);
    // The fixture server's 404 body has no lang or title: an inaccessible 404 page fails the site too.
    assert.ok(probe.blocking.some((v) => v.id === 'html-has-lang'), JSON.stringify(probe.blocking.map((v) => v.id)));
  } finally { await srv.close(); }
});

qtest('site-a11y run passes when every page and the 404 page pass, honours site.qa.a11yBlocking, and writes --out', async () => {
  const srv = await serveFixtures();
  const nf = await anyUrlServer(404);
  const soft = await anyUrlServer(200);
  try {
    const dir = stateWith(nf.url, [{ slug: 'fixed', url: `${srv.url}/a11y-oflex-fixed.html`, status: 'done', sections: [] }]);
    const out = path.join(tmpDir(), 'nested', 'site.json');
    const r = await run('run', dir, '--out', out);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual([j.pass, j.file, j.pages.map((p) => [p.slug, p.status, p.pass])], [true, out, [['fixed', 200, true], ['__404__', 404, true]]]);
    assert.ok(fs.existsSync(out));
    // A page answering 200 at the probe URL (content at any URL) fails the probe even when it is accessible.
    const p = JSON.parse((await run('run', stateWith(soft.url, []))).stdout).pages[0];
    assert.deepEqual([p.slug, p.status, p.blocking, p.patterns, p.pass], ['__404__', 200, [], [], false]);
    // The override applies here too: with landmark-unique off the list, the bad page's landmark-unique moves to other.
    const over = stateWith(nf.url, [{ slug: 'bad', url: `${srv.url}/a11y-oflex-bad.html`, status: 'done', sections: [] }]);
    updateState(over, (s) => { s.site.qa.a11yBlocking = ['heading-order']; });
    const bad = JSON.parse((await run('run', over)).stdout).pages[0];
    assert.ok(bad.other.some((v) => v.id === 'landmark-unique') && !bad.blocking.some((v) => v.id === 'landmark-unique'));
  } finally { await srv.close(); await nf.close(); await soft.close(); }
});
