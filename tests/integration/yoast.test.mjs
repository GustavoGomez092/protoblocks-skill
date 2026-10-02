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
// Crash recovery: tests/.tmp/yoast-options-snapshot.json holds the options as they were before the test.
const SNAPSHOT_FILE = path.join(TMP, 'yoast-options-snapshot.json');
const RESTORE_COMMAND = `${path.join(TMP, 'wp-test-site')} eval-file ${OPTIONS_PHP} restore ${SNAPSHOT_FILE}`;

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
const optionsCommand = (wp, cmd, obj) => {
  const f = path.join(TMP, `yoast-options-${cmd}-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(f, JSON.stringify(obj));
  try { return wp.evalFile(OPTIONS_PHP, [cmd, f]); } finally { fs.rmSync(f, { force: true }); }
};
const setOptions = (wp, flat) => optionsCommand(wp, 'set', flat); // seeds some of the 7 keys
const restoreOptions = (wp, snapshot) => optionsCommand(wp, 'restore', snapshot);

/** Snapshot the real Yoast options (the 7 keys and the whole wpseo_titles / wpseo_social), run fn, restore, assert equal. */
async function withOptionsRestored(wp, fn) {
  fs.mkdirSync(TMP, { recursive: true });
  if (fs.existsSync(SNAPSHOT_FILE)) {
    // A snapshot left behind means an earlier run crashed with the options possibly modified. Never overwrite it.
    throw new Error(`${SNAPSHOT_FILE} exists: a previous run crashed before restoring the Yoast options.\nRestore them, then delete the file:\n  ${RESTORE_COMMAND}`);
  }
  const before = snapshotOptions(wp);
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(before, null, 2));
  try {
    await fn();
  } finally {
    const after = restoreOptions(wp, before);
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
      assert.match(html, /<meta property="og:title" content="Emergency Plumber Austin" ?\/>/, 'social title has no dangling separator');
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
      assert.equal(org.options.company_name, 'New Co');
      assert.equal(org.options.company_or_person, 'company');
      assert.equal(org.options.company_logo_id, forced.media[1].id);
      assert.equal(org.options.facebook_site, 'https://www.facebook.com/pbitest');
      assert.equal(org.options.twitter_site, 'pbitest');
      assert.deepEqual(org.options.other_social_urls, ['https://www.linkedin.com/company/pbitest']);

      // A forced organization without a logo clears the old one; only the first facebook / twitter URL gets its own field.
      const noLogo = { ...seo, organization: { value: { name: 'New Co', socials: ['https://www.facebook.com/a', 'https://www.facebook.com/b', 'https://x.com/h1', 'https://twitter.com/h2'] }, inferred: false } };
      assert.equal(applySeo(wp, theme, slug, noLogo, { index: false, forceOrganization: true }).organization, 'set');
      const o2 = snapshotOptions(wp).options;
      assert.equal(o2.company_logo_id, 0);
      assert.equal(o2.company_logo, '');
      assert.equal(o2.facebook_site, 'https://www.facebook.com/a');
      assert.equal(o2.twitter_site, 'h1');
      assert.deepEqual(o2.other_social_urls, ['https://www.facebook.com/b', 'https://twitter.com/h2']);

      // A forced organization replaces the old Facebook / Twitter fields rather than leaving stale ones.
      const xOnly = { ...noLogo, organization: { value: { name: 'New Co', socials: ['https://x.com/h3'] }, inferred: false } };
      applySeo(wp, theme, slug, xOnly, { index: false, forceOrganization: true });
      const o3 = snapshotOptions(wp).options;
      assert.equal(o3.facebook_site, '');
      assert.equal(o3.twitter_site, 'h3');
      assert.deepEqual(o3.other_social_urls, []);

      // Dropping the schema from the SEO clears the JSON-LD the skill wrote earlier.
      const { schema: _drop, ...noSchema } = noLogo;
      assert.equal(applySeo(wp, theme, slug, noSchema, { index: false }).jsonld, 'cleared');
      assert.equal(yoast(wp, 'get', String(id)).jsonld, null);
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

itest('a Person site keeps its Organization, an unconfigured Company keeps existing socials, and the rendered title is checked', async () => {
  const wp = testWp();
  const hex = crypto.randomBytes(4).toString('hex');
  const slug = `pb-itest-seo-${hex}`;
  let id = null;
  await withOptionsRestored(wp, async () => {
    try {
      id = createPage(wp, slug, 'Person Page');
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-seoit-'));
      const theme = path.join(work, 'theme');
      initState(theme, { url: SITE_URL, path: '/x' });
      updateState(theme, (s) => { s.pages.push({ slug, title: 'Person Page', status: 'seo', postId: id, sections: [] }); });
      const seo = {
        focusKeyword: { value: 'emergency plumber', inferred: true, why: 'H1' },
        title: { value: 'Emergency Plumber Austin %%sep%% %%sitename%%', inferred: false },
        description: { value: desc, inferred: false },
        organization: { value: { name: 'New Co', socials: [] }, inferred: false },
      };
      try {
        setOptions(wp, { company_or_person: 'person', company_name: '' });
        assert.equal(applySeo(wp, theme, slug, seo, { index: false }).organization, 'kept');
        const person = snapshotOptions(wp).options;
        assert.equal(person.company_or_person, 'person', 'a Person site is never flipped to Company');
        assert.equal(person.company_name, '');

        setOptions(wp, { company_or_person: 'company', company_name: '', other_social_urls: ['https://example.com/pb-existing'] });
        assert.equal(applySeo(wp, theme, slug, seo, { index: false }).organization, 'set');
        const company = snapshotOptions(wp).options;
        assert.equal(company.company_name, 'New Co');
        assert.deepEqual(company.other_social_urls, ['https://example.com/pb-existing'], 'no socials supplied: existing ones stay');

        setOptions(wp, { separator: 'sc-ndash' });
        const site = yoast(wp, 'site');
        assert.equal(typeof site.siteName, 'string');
        assert.equal(site.sep, '\u2013', 'an HTML-entity separator is decoded to its character');
        const n = 61 - (2 + site.sep.length + site.siteName.length);
        if (n >= 1) {
          const tooLong = { ...seo, title: { value: `${'x'.repeat(n)} %%sep%% %%sitename%%`, inferred: false } };
          assert.throws(() => applySeo(wp, theme, slug, tooLong, { index: false }), (e) => e.code === 'ESEO' && /title: renders to 61 chars/.test(e.message));
        }
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    } finally {
      if (id) deleteById(wp, id);
    }
  });
});
