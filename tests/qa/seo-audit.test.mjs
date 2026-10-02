import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qtest, serveFixtures, makeImage, tmpDir, QA_DIR } from './helpers.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const OG = path.join(FIX, 'og.png');
const byId = (r, id) => r.checks.find((c) => c.id === id);

qtest('seoAudit passes the fixture page end to end', async () => {
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  const srv = await serveFixtures();
  const dir = tmpDir();
  try {
    await makeImage({ width: 1200, height: 630 }, OG);
    const out = path.join(dir, 'audit.json');
    const r = await seoAudit({ url: `${srv.url}/seo.html`, focusKeyword: 'emergency plumber', out });
    const fails = r.checks.filter((c) => c.status === 'fail');
    assert.deepEqual(fails, []);
    assert.equal(r.pass, true);
    assert.equal(byId(r, 'og-image').detail, 'HTTP 200 1200x630');
    assert.equal(byId(r, 'kw-slug').status, 'warn'); // fixture path is /seo.html
    assert.equal(byId(r, 'internal-link').status, 'pass');
    assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).pass, true);
  } finally { await srv.close(); fs.rmSync(OG, { force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

qtest('og-image fails when the file 404s', async () => {
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  fs.rmSync(OG, { force: true });
  const srv = await serveFixtures();
  try {
    const r = await seoAudit({ url: `${srv.url}/seo.html`, focusKeyword: 'emergency plumber' });
    assert.equal(byId(r, 'og-image').status, 'fail');
    assert.match(byId(r, 'og-image').detail, /HTTP 404/);
    assert.equal(r.pass, false);
  } finally { await srv.close(); }
});

qtest('og-image fails on wrong dimensions', async () => {
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  const srv = await serveFixtures();
  try {
    await makeImage({ width: 800, height: 600 }, OG);
    const r = await seoAudit({ url: `${srv.url}/seo.html`, focusKeyword: 'emergency plumber' });
    assert.equal(byId(r, 'og-image').status, 'fail');
    assert.equal(byId(r, 'og-image').detail, 'HTTP 200 800x600');
  } finally { await srv.close(); fs.rmSync(OG, { force: true }); }
});

qtest('extraction reports section selectors, missing alt, external-only links and bad JSON-LD', async () => {
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  const srv = await serveFixtures();
  try {
    const r = await seoAudit({ url: `${srv.url}/seo-bad.html`, focusKeyword: 'emergency plumber' });
    assert.equal(r.pass, false);
    assert.match(byId(r, 'h1-count').detail, /section#pb-s1 h1, section#pb-s3 h1/);
    assert.equal(byId(r, 'img-alt').status, 'fail');
    assert.equal(byId(r, 'internal-link').status, 'warn'); // external + #anchor only
    assert.equal(byId(r, 'jsonld-parse').status, 'fail');
    assert.match(byId(r, 'jsonld-required').detail, /Event\.startDate/);
    assert.equal(byId(r, 'canonical').status, 'fail');
    assert.equal(byId(r, 'og-image').detail, 'not fetched');
  } finally { await srv.close(); }
});

qtest('hidden and admin-bar headings and paragraphs are ignored', async () => {
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  const srv = await serveFixtures();
  try {
    const r = await seoAudit({ url: `${srv.url}/seo-hidden.html`, focusKeyword: 'emergency plumber' });
    assert.equal(byId(r, 'h1-count').status, 'pass', byId(r, 'h1-count').detail);
    assert.equal(r.extract.h.length, 1);
    assert.match(r.extract.firstParagraph, /^Visible paragraph/);
    assert.equal(byId(r, 'kw-first-paragraph').status, 'fail'); // the visible paragraph has no keyword; the hidden one did
  } finally { await srv.close(); }
});

qtest('a visually-hidden but rendered h1 (.screen-reader-text clip pattern) still counts', async () => {
  // It keeps client rects and is not display:none/visibility:hidden, so crawlers read it: two h1s is a real failure.
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  const srv = await serveFixtures();
  try {
    const r = await seoAudit({ url: `${srv.url}/seo-srtext.html`, focusKeyword: 'emergency plumber' });
    assert.equal(byId(r, 'h1-count').status, 'fail');
    assert.equal(r.extract.h.length, 2);
  } finally { await srv.close(); }
});

// ---- final-review fix wave ----
import { spawn, spawnSync } from 'node:child_process';

const AUDIT_CLI = path.join(QA_DIR, 'seo-audit.mjs');
// Async spawn: the fixture server runs in this process, so a sync spawn would block it.
const runCli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [AUDIT_CLI, ...args]);
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => resolve({ status, stdout, stderr }));
});

qtest('noindex page (Discourage search engines): canonical and robots-noindex are warnings that name the cause', async () => {
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  const srv = await serveFixtures();
  try {
    await makeImage({ width: 1200, height: 630 }, OG);
    const r = await seoAudit({ url: `${srv.url}/seo-noindex.html`, focusKeyword: 'emergency plumber' });
    assert.equal(r.extract.robots, 'noindex, follow');
    assert.equal(byId(r, 'canonical').status, 'warn');
    assert.match(byId(r, 'canonical').fix, /Discourage search engines.*never toggle it yourself/);
    assert.equal(byId(r, 'robots-noindex').status, 'warn');
    assert.equal(r.pass, true);
  } finally { await srv.close(); fs.rmSync(OG, { force: true }); }
});

qtest('the audit file records when and what was audited (at, url, focusKeyword)', async () => {
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  const srv = await serveFixtures();
  const dir = tmpDir();
  try {
    const before = Date.now();
    const out = path.join(dir, 'audit.json');
    await seoAudit({ url: `${srv.url}/seo.html`, focusKeyword: 'emergency plumber', out });
    const a = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(a.url, `${srv.url}/seo.html`);
    assert.equal(a.focusKeyword, 'emergency plumber');
    assert.match(a.at, /^\d{4}-\d\d-\d\dT/);
    assert.ok(Date.parse(a.at) >= before - 1000);
  } finally { await srv.close(); }
});

qtest('an HTTP error page fails fast with EHTTP instead of auditing the error page', async () => {
  const { seoAudit } = await import(path.join(QA_DIR, 'seo-audit.mjs'));
  const srv = await serveFixtures();
  const dir = tmpDir();
  try {
    const out = path.join(dir, 'audit.json');
    await assert.rejects(seoAudit({ url: `${srv.url}/no-such-page.html`, focusKeyword: 'x', out }), (e) => e.code === 'EHTTP' && /HTTP 404/.test(e.message));
    assert.equal(fs.existsSync(out), false, 'no audit file for a page that was not audited');
  } finally { await srv.close(); }
});

qtest('seo-audit CLI: exit 1 on failed checks, 2 on script errors (HTTP 404, unreachable host), 64 on usage', { timeout: 120000 }, async () => {
  const srv = await serveFixtures();
  try {
    const failed = await runCli('--url', `${srv.url}/seo-bad.html`, '--keyword', 'emergency plumber');
    assert.equal(failed.status, 1, failed.stderr);
    assert.equal(JSON.parse(failed.stdout).pass, false);
    const notFound = await runCli('--url', `${srv.url}/no-such-page.html`, '--keyword', 'x');
    assert.equal(notFound.status, 2, notFound.stderr);
    assert.match(notFound.stderr, /^\[EHTTP\] .*HTTP 404/);
  } finally { await srv.close(); }
  const down = await runCli('--url', 'http://127.0.0.1:9/', '--keyword', 'x');
  assert.equal(down.status, 2, down.stderr);
  assert.equal(spawnSync(process.execPath, [AUDIT_CLI, '--url', 'http://x'], { encoding: 'utf8' }).status, 64);
});
