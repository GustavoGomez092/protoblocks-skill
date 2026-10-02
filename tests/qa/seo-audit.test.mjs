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
