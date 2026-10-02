import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { itest, testWp, SITE_URL } from './helpers.mjs';
import { applySeo } from '../../skills/protoblocks-site-builder/scripts/lib/seo.mjs';
import { initState, updateState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { WP_SCRIPTS_DIR } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.resolve(HERE, '..', '.tmp');
const OPTIONS_PHP = path.join(HERE, 'yoast-options.php');
const YOAST_PHP = path.join(WP_SCRIPTS_DIR, 'yoast.php');
// Crash recovery: tests/.tmp/yoast-options-snapshot.json holds the options as they were before the test;
// restore with: wp eval-file tests/integration/yoast-options.php set tests/.tmp/yoast-options-snapshot.json
const SNAPSHOT_FILE = path.join(TMP, 'yoast-options-snapshot.json');

const desc = 'Licensed emergency plumbers in Austin available 24/7. Upfront pricing, same-day repairs and a 1-year guarantee on every job we do.';

const crc = (buf) => zlib.crc32 ? zlib.crc32(buf) : (() => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; })();
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body) >>> 0);
  return Buffer.concat([len, body, sum]);
};
// A 2x2 PNG with a random colour: unique bytes, so the media dedupe never reuses someone else's attachment.
function writePng(file) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const px = crypto.randomBytes(3);
  const row = Buffer.concat([Buffer.from([0]), px, px]);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat([row, row]))), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

const snapshotOptions = (wp) => wp.evalFile(OPTIONS_PHP, ['snapshot']);
const setOptions = (wp, obj) => {
  const f = path.join(TMP, `yoast-options-set-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(f, JSON.stringify(obj));
  try { return wp.evalFile(OPTIONS_PHP, ['set', f]); } finally { fs.rmSync(f, { force: true }); }
};

/** Snapshot the real Yoast options, run fn, then restore them exactly and assert they match. */
async function withOptionsRestored(wp, fn) {
  fs.mkdirSync(TMP, { recursive: true });
  const before = snapshotOptions(wp);
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(before, null, 2));
  try {
    await fn();
  } finally {
    const after = setOptions(wp, before);
    assert.deepEqual(after, before, 'Yoast options must be restored exactly');
    fs.rmSync(SNAPSHOT_FILE, { force: true });
  }
}

const createPage = (wp, slug, title) => Number(wp.check(['post', 'create', '--post_type=page', '--post_status=publish', `--post_name=${slug}`, `--post_title=${title}`, '--porcelain']).trim());
const deleteById = (wp, id) => { try { wp.check(['post', 'delete', String(id), '--force']); } catch (err) { console.error(`cleanup failed for ${id}: ${err.message}`); } };
const yoast = (wp, ...args) => wp.evalFile(YOAST_PHP, args);
const yoastSpec = (wp, spec) => {
  const f = path.join(TMP, `yoast-spec-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(f, typeof spec === 'string' ? spec : JSON.stringify(spec));
  try { return yoast(wp, 'apply', f); } finally { fs.rmSync(f, { force: true }); }
};

itest('applySeo writes Yoast meta, JSON-LD and Organization that the front end renders', async (t) => {
  const wp = testWp();
  const hex = crypto.randomBytes(4).toString('hex');
  const slug = `pb-itest-seo-${hex}`;
  const marker = `PB ITEST MARKER ${hex}`;
  const owned = new Set();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-seoit-'));
  let id = null;
  await withOptionsRestored(wp, async () => {
    try {
      id = createPage(wp, slug, 'Emergency Plumber');
      const theme = path.join(work, 'theme');
      initState(theme, { url: SITE_URL, path: '/x' });
      updateState(theme, (s) => { s.pages.push({ slug, title: 'Emergency Plumber', status: 'seo', postId: id, sections: [] }); });
      const og = path.join(work, `pb-itest-seo-${hex}-og.png`);
      const logo = path.join(work, `pb-itest-seo-${hex}-logo.png`);
      writePng(og); writePng(logo);
      const track = (r) => { for (const m of r.media) if (!m.reused) owned.add(m.id); };

      setOptions(wp, { company_name: 'Existing Co' });
      const seo = {
        focusKeyword: { value: 'emergency plumber', inferred: true, why: 'H1' },
        title: { value: 'Emergency Plumber Austin %%sep%% %%sitename%%', inferred: false },
        description: { value: desc, inferred: false },
        schemaPageType: { value: 'AboutPage', inferred: true, why: 'test' },
        schema: { value: [{ '@type': 'Service', name: marker }], inferred: true, why: 'test' },
        ogImage: { value: { file: og }, inferred: false },
        organization: { value: { name: 'New Co', logo: { file: logo }, socials: ['https://www.facebook.com/pbitest', 'https://x.com/pbitest', 'https://www.linkedin.com/company/pbitest'] }, inferred: true, why: 'footer' },
      };

      const r = applySeo(wp, theme, slug, seo, { index: false });
      track(r);
      assert.equal(r.organization, 'kept', 'an existing company_name is never overwritten');
      assert.equal(r.index, 'skipped');
      const got = yoast(wp, 'get', String(id));
      assert.equal(got.focuskw, 'emergency plumber');
      assert.equal(got.organizationName, 'Existing Co');
      assert.equal(got.schema_page_type, 'AboutPage');
      assert.equal(got['opengraph-image-id'], String(r.media[0].id));
      assert.equal(got.thumbnailId, r.media[0].id, 'og image becomes the featured image when the page has none');
      assert.equal(got.jsonld.length, 1);
      assert.equal(got.jsonld[0].name, marker);
      const rawMeta = wp.check(['post', 'meta', 'get', String(id), '_proto_jsonld']);
      assert.deepEqual(JSON.parse(rawMeta), [{ '@type': 'Service', name: marker }], 'stored as a JSON string, readable as the theme reads it');

      const html = await (await fetch(`${SITE_URL}/${slug}/`)).text();
      assert.match(html, /<title>Emergency Plumber Austin - /);
      assert.ok(html.includes(`<meta name="description" content="${desc}"`));
      assert.match(html, /"AboutPage"/);
      if (r.jsonld === 'written') {
        const m = html.match(/<script type="application\/ld\+json" class="yoast-schema-graph">(.*?)<\/script>/s);
        assert.ok(m, 'Yoast graph present');
        const graph = JSON.parse(m[1])['@graph'];
        const node = graph.find((p) => p.name === marker);
        assert.ok(node, 'custom node merged into the Yoast graph');
        assert.equal(node['@type'], 'Service');
        const home = await (await fetch(`${SITE_URL}/`)).text();
        assert.ok(!home.includes(marker), 'the JSON-LD must not appear on another page');
      } else {
        assert.equal(r.jsonld, 'unsupported');
        t.diagnostic('active theme lacks the JSON-LD extension; front-end JSON-LD assertions skipped');
      }

      const forced = applySeo(wp, theme, slug, seo, { index: false, forceOrganization: true });
      track(forced);
      assert.equal(forced.organization, 'set');
      const org = snapshotOptions(wp);
      assert.equal(org.company_name, 'New Co');
      assert.equal(org.company_or_person, 'company');
      assert.equal(org.company_logo_id, forced.media[1].id);
      assert.equal(org.facebook_site, 'https://www.facebook.com/pbitest');
      assert.equal(org.twitter_site, 'pbitest');
      assert.deepEqual(org.other_social_urls, ['https://www.linkedin.com/company/pbitest']);
    } finally {
      if (id) deleteById(wp, id);
      for (const att of owned) deleteById(wp, att);
    }
  });
  fs.rmSync(work, { recursive: true, force: true });
  assert.equal(wp.check(['post', 'list', '--post_type=page', '--post_status=any', `--name=${slug}`, '--format=ids']).trim(), '', 'test page deleted');
});

itest('yoast.php rejects bad input with typed errors and writes nothing', async () => {
  const wp = testWp();
  const hex = crypto.randomBytes(4).toString('hex');
  const slug = `pb-itest-seo-${hex}`;
  let id = null;
  await withOptionsRestored(wp, async () => {
    try {
      id = createPage(wp, slug, 'Guard Page');
      const code = (r) => r.error?.code;
      assert.equal(code(yoastSpec(wp, { postId: 0, meta: {} })), 'EINPUT');
      assert.equal(code(yoastSpec(wp, { postId: 'abc', meta: {} })), 'EINPUT');
      assert.equal(code(yoastSpec(wp, { postId: 987654321, meta: {} })), 'ENOPOST');
      const badJson = yoastSpec(wp, '{not json');
      assert.equal(code(badJson), 'EINPUT');
      assert.match(badJson.error.message, /valid JSON/);
      assert.equal(code(yoast(wp, 'apply', path.join(TMP, 'does-not-exist.json'))), 'EINPUT');
      assert.equal(code(yoast(wp, 'get', '987654321')), 'ENOPOST');
      assert.equal(code(yoast(wp, 'get', 'abc')), 'EINPUT');
      // Unknown keys are rejected as a whole: nothing from the same spec is written.
      assert.equal(code(yoastSpec(wp, { postId: id, meta: { focuskw: 'should not land', _wp_page_template: 'x' } })), 'EINPUT');
      assert.equal(code(yoastSpec(wp, { postId: id, meta: { focuskw: 'should not land', schema_page_type: 'LandingPage' } })), 'EINPUT');
      assert.equal(code(yoastSpec(wp, { postId: id, meta: { 'opengraph-image-id': 987654321 } })), 'EINPUT');
      assert.equal(code(yoastSpec(wp, { postId: id, meta: { focuskw: { a: 1 } } })), 'EINPUT');
      assert.equal(code(yoastSpec(wp, { postId: id, jsonld: { '@type': 'Thing' } })), 'EINPUT');
      assert.equal(code(yoastSpec(wp, { postId: id, organization: { name: 'Bad Co', socials: ['http://facebook.com/x'] } })), 'EINPUT');
      assert.equal(code(yoastSpec(wp, { postId: id, organization: { name: 'Bad Co', logoId: 987654321 } })), 'EINPUT');
      const got = yoast(wp, 'get', String(id));
      assert.equal(got.focuskw, '');
      assert.equal(got.jsonld, null);
      assert.equal(wp.run(['post', 'meta', 'get', String(id), '_wp_page_template']).stdout.trim(), '', 'unknown key was not written');
      // And a valid spec still works after the rejections.
      assert.equal(yoastSpec(wp, { postId: id, meta: { focuskw: 'guard ok' } }).written[0], 'focuskw');
    } finally {
      if (id) deleteById(wp, id);
    }
  });
});
