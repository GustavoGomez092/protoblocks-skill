import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { validateSeo, buildYoastSpec, applySeo, recordAudit, renderTitle, socialTitle, seoGet, pngSize } from '../../skills/protoblocks-site-builder/scripts/lib/seo.mjs';

const SEO_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'protoblocks-site-builder', 'scripts', 'lib', 'seo.mjs');
const desc = 'Licensed emergency plumbers in Austin available 24/7. Upfront pricing, same-day repairs and a 1-year guarantee on every job we do.';
const seo = {
  focusKeyword: { value: 'emergency plumber', inferred: true, why: 'H1' },
  title: { value: 'Emergency Plumber Austin %%sep%% %%sitename%%', inferred: false },
  description: { value: desc, inferred: false },
  schemaPageType: { value: 'WebPage', inferred: true, why: 'landing' },
  schema: { value: [{ '@type': 'Service', name: 'Emergency plumbing' }], inferred: true, why: 'services' },
};
const code = (c) => (e) => e.code === c;
const withLeaf = (k, value, extra = {}) => ({ ...seo, [k]: { value, inferred: false, ...extra } });

test('valid SEO passes validation', () => {
  assert.equal(desc.length >= 120 && desc.length <= 156, true);
  assert.deepEqual(validateSeo(seo), []);
});

test('validation catches length, keyword, type and missing rationale', () => {
  const bad = { ...seo,
    focusKeyword: { value: 'Emergency Plumber Austin Texas Now', inferred: true },
    title: { value: 'An extremely long title that goes well beyond sixty characters %%sep%% Site', inferred: false },
    description: { value: 'too short', inferred: false },
    schemaPageType: { value: 'LandingPage', inferred: false } };
  const errs = validateSeo(bad).join('\n');
  for (const k of ['focusKeyword', 'why', 'title', 'description', 'schemaPageType']) assert.match(errs, new RegExp(k));
});

test('non-object SEO is reported, not thrown', () => {
  assert.match(validateSeo(null).join('\n'), /seo/);
  assert.match(validateSeo(undefined).join('\n'), /seo/);
});

test('focusKeyword rejects %, < and >', () => {
  for (const kw of ['100% plumber', 'plumber <b>', 'a > b']) assert.match(validateSeo(withLeaf('focusKeyword', kw)).join('\n'), /focusKeyword/, kw);
});

test('description rejects newlines', () => {
  const d = `${desc.slice(0, 60)}\n${desc.slice(61)}`;
  assert.equal(d.length, desc.length);
  assert.match(validateSeo(withLeaf('description', d)).join('\n'), /description.*newline/);
});

test('organization socials must be https URLs', () => {
  const org = (socials) => withLeaf('organization', { name: 'Acme', socials });
  assert.deepEqual(validateSeo(org(['https://facebook.com/acme'])), []);
  for (const s of ['http://facebook.com/acme', 'javascript:alert(1)', 'facebook.com/acme', 42]) {
    assert.match(validateSeo(org([s])).join('\n'), /socials/, String(s));
  }
  assert.match(validateSeo(org('https://x.com/a')).join('\n'), /socials/);
});

test('organization needs a name', () => {
  assert.match(validateSeo(withLeaf('organization', { socials: [] })).join('\n'), /organization.*name/);
});

test('buildYoastSpec maps fields and falls back for social titles', () => {
  const spec = buildYoastSpec({ postId: 9, seo, ogImageId: 44, organizationLogoId: null, forceOrganization: false });
  assert.equal(spec.meta.focuskw, 'emergency plumber');
  assert.equal(spec.meta.metadesc, desc);
  assert.equal(spec.meta['opengraph-title'], 'Emergency Plumber Austin');
  assert.equal(spec.meta['twitter-title'], 'Emergency Plumber Austin');
  assert.equal(spec.meta['opengraph-image-id'], 44);
  assert.equal(spec.meta['twitter-image-id'], 44);
  assert.equal(spec.featuredImageId, 44);
  assert.equal(spec.meta.schema_page_type, 'WebPage');
  assert.equal(spec.organization, null);
  assert.deepEqual(spec.jsonld, [{ '@type': 'Service', name: 'Emergency plumbing' }]);
});

// ---- applySeo with a scripted WP-CLI ----
const LIVE_KEYS = ['focuskw', 'title', 'metadesc', 'opengraph-title', 'opengraph-description', 'opengraph-image-id', 'twitter-title', 'twitter-description', 'twitter-image-id', 'schema_page_type', 'jsonld'];
const emptyLive = () => Object.fromEntries(LIVE_KEYS.map((k) => [k, '']));
const DEFAULT_ORG = { represents: 'company', name: 'Existing Co', logoId: 5 };
function harness({ jsonldSupported = true, indexCode = 0, site = { siteName: 'Acme Plumbing', sep: '-', organization: DEFAULT_ORG }, applyReply = null, siteFails = null, live = {} } = {}) {
  const calls = [];
  const specs = [];
  const imports = [];
  // Simulated Yoast post meta: what `get` reads and `apply` writes (the PHP readback is the stored values).
  const store = { ...emptyLive(), ...live };
  const exec = (cmd, args) => {
    calls.push(args);
    if (args[0] === 'eval') return { code: 0, stdout: jsonldSupported ? '1' : '0', stderr: '' };
    if (args[0] === 'yoast') return { code: indexCode, stdout: '', stderr: indexCode ? 'boom' : '' };
    if (args[0] === 'eval-file' && args[1].endsWith('media.php')) {
      imports.push(JSON.parse(Buffer.from(args[3], 'base64url').toString('utf8')));
      return { code: 0, stdout: '{"id":77,"url":"u","alt":"a","mime":"image/png","reused":true}\n', stderr: '' };
    }
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php') && args[2] === 'site' && siteFails === 'untyped') return { code: 1, stdout: '', stderr: 'Fatal: no WPSEO_Option_Titles' };
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php') && args[2] === 'site' && siteFails === 'typed') return { code: 0, stdout: '{"error":{"code":"EYOAST","message":"Yoast SEO is not active."}}\n', stderr: '' };
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php') && args[2] === 'site') return { code: 0, stdout: `${JSON.stringify(site)}\n`, stderr: '' };
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php') && args[2] === 'get') return { code: 0, stdout: `${JSON.stringify({ postId: Number(args[3]), ...store, organizationName: '', thumbnailId: 0 })}\n`, stderr: '' };
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php')) {
      if (applyReply) return { code: 0, stdout: `${JSON.stringify(applyReply)}\n`, stderr: '' };
      const spec = JSON.parse(fs.readFileSync(args[3], 'utf8'));
      specs.push(spec);
      for (const [k, v] of Object.entries(spec.meta ?? {})) if (v !== null && v !== '') store[k] = String(v);
      if ('jsonld' in spec) store.jsonld = spec.jsonld?.length ? JSON.stringify(spec.jsonld, null, 4) : '';
      return { code: 0, stdout: `${JSON.stringify({ postId: 9, written: ['focuskw'], featuredImageSet: false, organization: 'skipped', stored: { ...store } })}\n`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
  };
  return { wp: createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }), calls, specs, imports, store };
}
function project(pages = [{ slug: 'home', title: 'Home', status: 'seo', postId: 9, sections: [] }]) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-seo-unit-'));
  initState(theme, { url: 'http://x.test', path: '/x' });
  updateState(theme, (s) => { s.pages.push(...pages); });
  return theme;
}
// A real 1200x630 PNG (all black): supplied OG images of the right size are imported as they are.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (~c) >>> 0; };
const pngChunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, sum]); };
function writePng(file, width, height) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]));
  return file;
}
const png = writePng(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-seo-img-')), 'og.png'), 1200, 630);

test('applySeo: invalid SEO throws ESEO before any WP call', () => {
  const { wp, calls } = harness();
  const theme = project();
  assert.throws(() => applySeo(wp, theme, 'home', withLeaf('description', 'short')), code('ESEO'));
  assert.equal(calls.length, 0);
});

test('applySeo: unknown page or page without postId is ENOPAGE and touches nothing', () => {
  const { wp, calls } = harness();
  const theme = project([{ slug: 'home', status: 'building', postId: null, sections: [] }]);
  assert.throws(() => applySeo(wp, theme, 'home', seo), code('ENOPAGE'));
  assert.throws(() => applySeo(wp, theme, 'nope', seo), code('ENOPAGE'));
  assert.equal(calls.length, 0);
});

test('applySeo: a missing ogImage or logo file is EFILE before any import', () => {
  const { wp, calls } = harness();
  const theme = project();
  const missing = path.join(os.tmpdir(), 'pb-seo-does-not-exist.png');
  assert.throws(() => applySeo(wp, theme, 'home', { ...seo, ogImage: { value: { file: missing }, inferred: false } }), code('EFILE'));
  const org = { name: 'Acme', logo: { file: missing } };
  assert.throws(() => applySeo(wp, theme, 'home', { ...seo, organization: { value: org, inferred: false } }), code('EFILE'));
  assert.equal(calls.length, 0);
});

test('applySeo: a missing logo file fails before the og image is imported', () => {
  const { wp, calls } = harness();
  const missing = path.join(os.tmpdir(), 'pb-seo-does-not-exist.png');
  const full = { ...seo, ogImage: { value: { file: png }, inferred: false }, organization: { value: { name: 'Acme', logo: { file: missing } }, inferred: false } };
  assert.throws(() => applySeo(wp, project(), 'home', full), code('EFILE'));
  assert.equal(calls.length, 0, 'no attachment may be created by a run that cannot finish');
});

test('applySeo: malformed schema is ESEO before any WP call', () => {
  const { wp, calls } = harness();
  const bad = { ...seo, ogImage: { value: { file: png }, inferred: false }, schema: { value: [{ name: 'no type' }], inferred: false } };
  assert.throws(() => applySeo(wp, project(), 'home', bad), code('ESEO'));
  assert.equal(calls.length, 0);
});

test('applySeo: writes spec, reports jsonld, index and stores state', () => {
  const { wp, calls, specs } = harness();
  const theme = project();
  const r = applySeo(wp, theme, 'home', { ...seo, ogImage: { value: { file: png }, inferred: false } }, { index: false });
  assert.equal(r.jsonld, 'written');
  assert.equal(r.index, 'skipped');
  assert.equal(specs[0].meta['opengraph-image-id'], 77);
  assert.equal(specs[0].forceOrganization, false);
  assert.deepEqual(r.media, [{ role: 'ogImage', id: 77, reused: true }]);
  assert.ok(!calls.some((a) => a[0] === 'yoast'));
  const p = loadState(theme).pages[0];
  assert.match(p.seo.applied, /^\d{4}-/);
  assert.equal(p.seo.ogImageId, 77);
  assert.equal(fs.readdirSync(os.tmpdir()).some((n) => n.startsWith('pb-seo-') && fs.existsSync(path.join(os.tmpdir(), n, 'spec.json'))), false);
});

test('applySeo: index defaults to true and a failure is recorded, not thrown', () => {
  const { wp, calls } = harness({ indexCode: 1 });
  const r = applySeo(wp, project(), 'home', seo);
  assert.ok(calls.some((a) => a[0] === 'yoast' && a.includes('index')));
  assert.match(r.index, /^failed: boom/);
});

test('applySeo: unsupported theme omits jsonld from the spec; absent schema leaves existing meta alone', () => {
  const a = harness({ jsonldSupported: false });
  assert.equal(applySeo(a.wp, project(), 'home', seo, { index: false }).jsonld, 'unsupported');
  assert.equal('jsonld' in a.specs[0], false);
  const b = harness();
  const { schema: _s, ...noSchema } = seo;
  assert.equal(applySeo(b.wp, project(), 'home', noSchema, { index: false }).jsonld, 'none');
  assert.equal('jsonld' in b.specs[0], false, 'no schema must not delete the page JSON-LD');
});

test('applySeo: forceOrganization is passed through only when set', () => {
  const org = { ...seo, organization: { value: { name: 'Acme', socials: [] }, inferred: false } };
  const a = harness();
  applySeo(a.wp, project(), 'home', org, { index: false });
  assert.equal(a.specs[0].forceOrganization, false);
  const b = harness();
  applySeo(b.wp, project(), 'home', org, { index: false, forceOrganization: true });
  assert.equal(b.specs[0].forceOrganization, true);
});

// ---- recordAudit ----
const auditFile = (obj) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-audit-')), 'audit.json'); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
const APPLIED = '2026-10-01T10:00:00.000Z';
const PAGE_URL = 'http://x.test/home/';
const seoPage = (extra = {}) => [{ slug: 'home', title: 'Home', status: 'seo', postId: 9, url: PAGE_URL, sections: [], seo: { focusKeyword: seo.focusKeyword, applied: APPLIED }, ...extra }];
const audit = (extra = {}) => ({ pass: true, checks: [], url: PAGE_URL, focusKeyword: 'emergency plumber', at: '2026-10-01T10:05:00.000Z', ...extra });

test('recordAudit: a passing audit sets the page to done and stores the absolute path', () => {
  const theme = project(seoPage());
  const f = auditFile(audit());
  assert.deepEqual(recordAudit(theme, 'home', f), { pass: true, status: 'done' });
  const p = loadState(theme).pages[0];
  assert.equal(p.status, 'done');
  assert.equal(p.seo.audit.pass, true);
  assert.equal(p.seo.audit.file, path.resolve(f));
  assert.equal(p.seo.audit.at, '2026-10-01T10:05:00.000Z', 'the audit time, not the record time');
});

test('recordAudit: a failing audit keeps the status and stores pass:false; relative paths become absolute', () => {
  const theme = project(seoPage());
  const f = auditFile(audit({ pass: false }));
  const rel = path.relative(process.cwd(), f);
  assert.deepEqual(recordAudit(theme, 'home', rel), { pass: false, status: 'seo' });
  const p = loadState(theme).pages[0];
  assert.equal(p.status, 'seo');
  assert.equal(p.seo.audit.pass, false);
  assert.equal(p.seo.audit.file, f);
});

test('recordAudit: a page with an open (reopened) section is ESTATUS and changes nothing; planned/done/skipped do not block', () => {
  for (const st of ['building', 'verifying', 'animating']) {
    const theme = project(seoPage({ sections: [{ n: 1, anchor: 'pb-s1', status: 'done' }, { n: 2, anchor: 'pb-s2', status: st }] }));
    assert.throws(() => recordAudit(theme, 'home', auditFile(audit())), (e) => e.code === 'ESTATUS' && new RegExp(`2: ${st}`).test(e.message), st);
    const p = loadState(theme).pages[0];
    assert.deepEqual([p.status, p.seo.audit], ['seo', undefined]);
  }
  const theme = project(seoPage({ sections: [{ n: 1, anchor: 'pb-s1', status: 'done' }, { n: 2, anchor: 'pb-s2', status: 'skipped' }] }));
  assert.deepEqual(recordAudit(theme, 'home', auditFile(audit())), { pass: true, status: 'done' });
});

test('recordAudit: keeps existing seo fields', () => {
  const theme = project(seoPage());
  recordAudit(theme, 'home', auditFile(audit()));
  assert.equal(loadState(theme).pages[0].seo.focusKeyword.value, 'emergency plumber');
  assert.equal(loadState(theme).pages[0].seo.applied, APPLIED);
});

test('recordAudit: missing page is ENOPAGE; unreadable or invalid audit is EINPUT and changes nothing', () => {
  const theme = project(seoPage());
  assert.throws(() => recordAudit(theme, 'nope', auditFile(audit())), code('ENOPAGE'));
  assert.throws(() => recordAudit(theme, 'home', path.join(os.tmpdir(), 'pb-no-such-audit.json')), code('EINPUT'));
  assert.throws(() => recordAudit(theme, 'home', auditFile('{not json')), code('EINPUT'));
  assert.throws(() => recordAudit(theme, 'home', auditFile('[1,2]')), code('EINPUT'));
  assert.throws(() => recordAudit(theme, 'home', auditFile({ checks: [] })), code('EINPUT'));
  const p = loadState(theme).pages[0];
  assert.equal(p.status, 'seo');
  assert.equal(p.seo.audit, undefined);
});

test('recordAudit: an audit of another keyword, another URL, or from before the last apply is EAUDITSTALE and changes nothing', () => {
  const theme = project(seoPage());
  const stale = (extra, re) => assert.throws(() => recordAudit(theme, 'home', auditFile(audit(extra))), (e) => e.code === 'EAUDITSTALE' && re.test(e.message), JSON.stringify(extra));
  stale({ focusKeyword: 'plumber' }, /keyword "plumber".*"emergency plumber"/);
  stale({ focusKeyword: undefined }, /keyword/);
  stale({ url: 'http://x.test/other/' }, /http:\/\/x\.test\/other\/.*http:\/\/x\.test\/home\//);
  stale({ url: undefined }, /url/i);
  stale({ at: '2026-10-01T09:59:59.000Z' }, /before.*apply/);
  stale({ at: APPLIED }, /before.*apply/);
  stale({ at: undefined }, /at/);
  stale({ at: 'yesterday' }, /at/);
  const p = loadState(theme).pages[0];
  assert.equal(p.status, 'seo');
  assert.equal(p.seo.audit, undefined);
});

test('recordAudit: the page URL matches with or without a trailing slash', () => {
  const theme = project(seoPage());
  assert.equal(recordAudit(theme, 'home', auditFile(audit({ url: 'http://x.test/home' }))).status, 'done');
});

test('recordAudit: SEO never applied is EAUDITSTALE', () => {
  const theme = project([{ slug: 'home', title: 'Home', status: 'seo', postId: 9, url: PAGE_URL, sections: [] }]);
  assert.throws(() => recordAudit(theme, 'home', auditFile(audit())), (e) => e.code === 'EAUDITSTALE' && /seo\.mjs apply/.test(e.message));
});

test('recordAudit: only a page in status seo is promoted; any other status is ESTATUS and changes nothing', () => {
  for (const status of ['planning', 'building', 'done']) {
    const theme = project(seoPage({ status }));
    assert.throws(() => recordAudit(theme, 'home', auditFile(audit())), (e) => e.code === 'ESTATUS' && e.message.includes(`"${status}"`), status);
    const p = loadState(theme).pages[0];
    assert.equal(p.status, status);
    assert.equal(p.seo.audit, undefined);
  }
});

// ---- CLI ----
const cli = (...args) => spawnSync(process.execPath, [SEO_CLI, ...args], { encoding: 'utf8' });

test('CLI: missing arguments exit 64 for both commands', () => {
  assert.equal(cli().status, 64);
  assert.equal(cli('apply', '/t', 'home').status, 64);
  assert.equal(cli('record-audit', '/t', 'home').status, 64);
  assert.equal(cli('bogus', '/t', 'home', 'f').status, 64);
});

test('CLI: unparseable seo.json is a one-line EINPUT with exit 1', () => {
  const f = auditFile('{nope');
  const r = cli('apply', os.tmpdir(), 'home', f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\[EINPUT\] .+\n$/);
});

test('CLI: record-audit works end to end', () => {
  const theme = project(seoPage());
  const r = cli('record-audit', theme, 'home', auditFile(audit()));
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).status, 'done');
  const bad = cli('record-audit', theme, 'nope', auditFile(audit()));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^\[ENOPAGE\]/);
});

// ---- fix round 1 ----
test('renderTitle: defaults drop the site name; context substitutes the real site name and separator', () => {
  assert.equal(renderTitle('A %%sep%% %%sitename%%'), 'A - ');
  assert.equal(renderTitle('A %%sep%% %%sitename%%', { siteName: 'Acme', sep: '|' }), 'A | Acme');
});

test('socialTitle drops Yoast vars and dangling separators', () => {
  assert.equal(socialTitle('Emergency Plumber Austin %%sep%% %%sitename%%'), 'Emergency Plumber Austin');
  assert.equal(socialTitle('%%sitename%% %%sep%% Emergency Plumber'), 'Emergency Plumber');
  assert.equal(socialTitle('Plumber – '), 'Plumber');
  assert.equal(socialTitle('Plumber | Austin'), 'Plumber | Austin');
  for (const sepChar of ['-', '–', '—', '|', '·', '•', ':']) assert.equal(socialTitle(`Plumber ${sepChar} %%sitename%%`), 'Plumber', sepChar);
});

test('validateSeo with site context checks the fully rendered title against 60 chars', () => {
  const t = 'Emergency Plumber in Austin Texas Open 24 7 %%sep%% %%sitename%%';
  const leaf = withLeaf('title', t);
  assert.deepEqual(validateSeo(leaf), [], 'without context the site name is not counted');
  assert.deepEqual(validateSeo(leaf, { siteName: 'Acme', sep: '-' }), []);
  const errs = validateSeo(leaf, { siteName: 'Acme Plumbing and Heating Services', sep: '|' }).join('\n');
  assert.match(errs, /title: renders to \d+ chars/);
  assert.match(errs, /Acme Plumbing and Heating Services/);
});

test('applySeo validates the title with the real site name and separator, before any import', () => {
  const long = { ...seo, title: { value: 'Emergency Plumber Austin Texas 24 7 Service %%sep%% %%sitename%%', inferred: false }, ogImage: { value: { file: png }, inferred: false } };
  const a = harness({ site: { siteName: 'Acme Plumbing and Heating Services', sep: '|' } });
  assert.throws(() => applySeo(a.wp, project(), 'home', long, { index: false }), code('ESEO'));
  assert.ok(!a.calls.some((c) => c[1]?.endsWith('media.php')), 'no import for a title that cannot be applied');
  const b = harness({ site: { siteName: 'Acme', sep: '-' } });
  assert.equal(applySeo(b.wp, project(), 'home', long, { index: false }).index, 'skipped');
});

test('applySeo: re-applying a done page returns it to seo; other statuses are untouched', () => {
  const theme = project([{ slug: 'home', title: 'Home', status: 'done', postId: 9, sections: [], seo: { audit: { pass: true, file: '/a', at: 'x' } } }]);
  applySeo(harness().wp, theme, 'home', seo, { index: false });
  const p = loadState(theme).pages[0];
  assert.equal(p.status, 'seo');
  assert.equal(p.seo.audit, undefined, 'the old audit no longer applies');
  const t2 = project([{ slug: 'home', title: 'Home', status: 'building', postId: 9, sections: [] }]);
  applySeo(harness().wp, t2, 'home', seo, { index: false });
  assert.equal(loadState(t2).pages[0].status, 'building');
});

test('applySeo: schema previously applied by the skill is cleared when the new SEO has none', () => {
  const { schema: _s, ...noSchema } = seo;
  const prior = [{ slug: 'home', title: 'Home', status: 'seo', postId: 9, sections: [], seo: { schema: seo.schema } }];
  const a = harness();
  const r = applySeo(a.wp, project(prior), 'home', noSchema, { index: false });
  assert.deepEqual(a.specs[0].jsonld, []);
  assert.equal(r.jsonld, 'cleared');
  const b = harness();
  assert.equal(applySeo(b.wp, project(), 'home', noSchema, { index: false }).jsonld, 'none');
  assert.equal('jsonld' in b.specs[0], false, 'no prior skill schema: leave the page JSON-LD alone');
  const c = harness({ live: { jsonld: JSON.stringify(seo.schema.value) } }); // the page still holds the earlier schema
  applySeo(c.wp, project(prior), 'home', seo, { index: false });
  assert.equal(c.specs[0].jsonld.length, 1, 'a new schema replaces the old one');
});

test('applySeo: an {error} reply from yoast.php becomes a typed throw and state is not touched', () => {
  const theme = project();
  const a = harness({ applyReply: { error: { code: 'ENOPOST', message: 'Post 9 does not exist' } } });
  assert.throws(() => applySeo(a.wp, theme, 'home', seo, { index: false }), (e) => e.code === 'ENOPOST' && /Post 9/.test(e.message));
  assert.equal(loadState(theme).pages[0].seo, undefined);
  const b = harness({ applyReply: { error: { message: 'odd' } } });
  assert.throws(() => applySeo(b.wp, theme, 'home', seo, { index: false }), code('EYOAST'));
  assert.ok(!a.calls.some((c) => c[0] === 'yoast'), 'no index after a failed write');
});

// ---- fix round 2 ----
for (const kind of ['untyped', 'typed']) {
  test(`applySeo: a ${kind} failure of the site lookup degrades to the context-free title check with a warning`, () => {
    const h = harness({ siteFails: kind });
    const r = applySeo(h.wp, project(), 'home', seo, { index: false });
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /^site context unavailable: .+/);
    assert.equal(h.specs.length, 1, 'the SEO is still applied');
    const tooLong = { ...seo, title: { value: 'An extremely long title that goes well beyond sixty characters %%sep%% Site', inferred: false } };
    assert.throws(() => applySeo(harness({ siteFails: kind }).wp, project(), 'home', tooLong, { index: false }), code('ESEO'), 'the context-free check still runs');
  });
}

test('applySeo: no warnings key when the site context was available', () => {
  assert.equal('warnings' in applySeo(harness().wp, project(), 'home', seo, { index: false }), false);
});

test('applySeo: stale schema is cleared only when the theme supports JSON-LD', () => {
  const { schema: _s, ...noSchema } = seo;
  const prior = () => project([{ slug: 'home', title: 'Home', status: 'seo', postId: 9, sections: [], seo: { schema: seo.schema } }]);
  const off = harness({ jsonldSupported: false });
  assert.equal(applySeo(off.wp, prior(), 'home', noSchema, { index: false }).jsonld, 'unsupported');
  assert.equal('jsonld' in off.specs[0], false, 'unsupported theme: meta left alone');
  const on = harness({ jsonldSupported: true });
  assert.equal(applySeo(on.wp, prior(), 'home', noSchema, { index: false }).jsonld, 'cleared');
  assert.deepEqual(on.specs[0].jsonld, []);
});

test('validateSeo rejects flat leaves without a value key', () => {
  const base = {
    focusKeyword: { value: 'emergency plumber', inferred: false },
    title: { value: 'Emergency Plumber %%sep%% %%sitename%%', inferred: false },
    description: { value: 'Burst pipe or no hot water? Our plumbers arrive fast, fix it right the first time and quote before work starts. Call or book online today.', inferred: false },
  };
  assert.deepEqual(validateSeo(base), []);
  assert.ok(validateSeo({ ...base, ogImage: { file: 'og.png', inferred: false } }).includes('ogImage: needs {value, inferred}'));
  assert.ok(validateSeo({ ...base, organization: { name: 'Acme', inferred: false } }).includes('organization: needs {value, inferred}'));
  assert.deepEqual(validateSeo({ ...base, ogImage: { value: { file: 'og.png' }, inferred: false } }), []);
});

// ---- final-review fix wave ----
const meta = (h) => h.specs.at(-1).meta;
const appliedPage = (appliedValues, extra = {}) => [{ slug: 'home', title: 'Home', status: 'seo', postId: 9, url: 'http://x.test/home/', sections: [], seo: { ...seo, applied: APPLIED, appliedValues }, ...extra }];

test('buildYoastSpec omits schema_page_type when the leaf is absent', () => {
  const { schemaPageType: _p, ...noType } = seo;
  assert.equal('schema_page_type' in buildYoastSpec({ postId: 9, seo: noType }).meta, false);
  assert.equal(buildYoastSpec({ postId: 9, seo }).meta.schema_page_type, 'WebPage');
});

test('applySeo: an explicit empty schema on an unsupported theme reports unsupported and does not delete the meta', () => {
  const empty = { ...seo, schema: { value: [], inferred: false } };
  const off = harness({ jsonldSupported: false });
  assert.equal(applySeo(off.wp, project(), 'home', empty, { index: false }).jsonld, 'unsupported');
  assert.equal('jsonld' in off.specs[0], false);
  const on = harness();
  assert.equal(applySeo(on.wp, project(), 'home', empty, { index: false }).jsonld, 'cleared');
  assert.deepEqual(on.specs[0].jsonld, []);
});

test('applySeo: applies through evalFilePayload (yoast.php apply <payload.json>) and leaves no temp file', () => {
  const h = harness();
  applySeo(h.wp, project(), 'home', seo, { index: false });
  const call = h.calls.find((a) => a[1]?.endsWith('yoast.php') && a[2] === 'apply');
  assert.match(path.basename(path.dirname(call[3])), /^pb-payload-/);
  assert.equal(fs.existsSync(call[3]), false);
});

test('applySeo: an Organization that will be kept does not import its logo', () => {
  const withOrg = { ...seo, organization: { value: { name: 'New Co', logo: { file: png } }, inferred: false } };
  const kept = harness({ site: { siteName: 'Acme', sep: '-', organization: { represents: 'company', name: 'Existing Co', logoId: 5 } } });
  const r = applySeo(kept.wp, project(), 'home', withOrg, { index: false });
  assert.deepEqual(r.media, []);
  assert.equal(kept.imports.length, 0, 'no attachment for a logo Yoast will not use');
  assert.equal(kept.specs[0].organization.logoId, null);
  const person = harness({ site: { siteName: 'Acme', sep: '-', organization: { represents: 'person', name: '', logoId: 0 } } });
  applySeo(person.wp, project(), 'home', withOrg, { index: false });
  assert.equal(person.imports.length, 0, 'a Person site keeps its Organization');
  const empty = harness({ site: { siteName: 'Acme', sep: '-', organization: { represents: 'company', name: '', logoId: 0 } } });
  assert.deepEqual(applySeo(empty.wp, project(), 'home', withOrg, { index: false }).media, [{ role: 'organizationLogo', id: 77, reused: true }]);
  const forced = harness();
  applySeo(forced.wp, project(), 'home', withOrg, { index: false, forceOrganization: true });
  assert.equal(forced.imports.length, 1, 'forced: the logo is used');
});

test('applySeo: an Organization without a logo warns that Yoast prints no Organization piece', () => {
  const noLogo = { ...seo, organization: { value: { name: 'New Co' }, inferred: false } };
  const h = harness({ site: { siteName: 'Acme', sep: '-', organization: { represents: 'company', name: '', logoId: 0 } } });
  const r = applySeo(h.wp, project(), 'home', noLogo, { index: false });
  assert.ok(r.warnings.some((w) => /no logo/.test(w) && /no Organization/.test(w)), JSON.stringify(r.warnings));
  const kept = applySeo(harness().wp, project(), 'home', noLogo, { index: false });
  assert.equal('warnings' in kept, false, 'kept: Yoast keeps its own organization and logo');
});

test('pngSize reads PNG dimensions and returns null for other files', () => {
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
  const other = path.join(path.dirname(png), 'x.jpg');
  fs.writeFileSync(other, 'not a png');
  assert.equal(pngSize(other), null);
});

test('applySeo: a supplied 1200x630 OG image is imported as it is (resized: false)', () => {
  const h = harness();
  const r = applySeo(h.wp, project(), 'home', { ...seo, ogImage: { value: { file: png }, inferred: false } }, { index: false });
  assert.equal(h.imports[0].file, fs.realpathSync(png));
  assert.deepEqual(r.ogImage, { file: png, resized: false, source: { width: 1200, height: 630 } });
});

test('applySeo stores the values it applied (the Yoast readback) in page.seo.appliedValues', () => {
  const h = harness();
  const theme = project();
  applySeo(h.wp, theme, 'home', seo, { index: false });
  const a = loadState(theme).pages[0].seo.appliedValues;
  assert.equal(a.metadesc, desc);
  assert.equal(a.focuskw, 'emergency plumber');
  assert.equal(a.schema_page_type, 'WebPage');
  assert.deepEqual(JSON.parse(a.jsonld), [{ '@type': 'Service', name: 'Emergency plumbing' }]);
  assert.equal('opengraph-image-id' in a, false, 'not written: no og image');
});

test('seoGet returns the live Yoast values, the values last applied and which fields were edited since', () => {
  const h = harness({ live: { metadesc: 'Hand edited', focuskw: 'emergency plumber', jsonld: '[{"@type":"Thing"}]' } });
  const theme = project(appliedPage({ metadesc: desc, focuskw: 'emergency plumber' }));
  const r = seoGet(h.wp, theme, 'home');
  assert.equal(r.postId, 9);
  assert.equal(r.values.metadesc, 'Hand edited');
  assert.equal(r.values.jsonld, '[{"@type":"Thing"}]', 'the JSON-LD as the stored string');
  assert.equal(r.appliedValues.metadesc, desc);
  assert.deepEqual(r.edited.map((e) => e.field).sort(), ['jsonld', 'metadesc']);
  assert.throws(() => seoGet(h.wp, theme, 'nope'), code('ENOPAGE'));
});

test('applySeo: a value edited in wp-admin since the last apply is EEDITED (live and applied listed); nothing is imported or written', () => {
  const h = harness({ live: { metadesc: 'Hand edited in wp-admin', focuskw: 'emergency plumber' } });
  const theme = project(appliedPage({ metadesc: desc, focuskw: 'emergency plumber' }));
  const withOg = { ...seo, ogImage: { value: { file: png }, inferred: false } };
  assert.throws(() => applySeo(h.wp, theme, 'home', withOg, { index: false }), (e) => e.code === 'EEDITED'
    && /metadesc/.test(e.message) && e.message.includes('Hand edited in wp-admin') && e.message.includes(desc) && /--force/.test(e.message)
    && e.fields.length === 1 && e.fields[0].field === 'metadesc' && e.fields[0].live === 'Hand edited in wp-admin' && e.fields[0].applied === desc);
  assert.equal(h.imports.length, 0);
  assert.equal(h.specs.length, 0);
  assert.equal(loadState(theme).pages[0].seo.appliedValues.metadesc, desc, 'state untouched');
});

test('applySeo with force overwrites edited values and reports them', () => {
  const h = harness({ live: { metadesc: 'Hand edited in wp-admin' } });
  const theme = project(appliedPage({ metadesc: desc }));
  const r = applySeo(h.wp, theme, 'home', seo, { index: false, force: true });
  assert.equal(meta(h).metadesc, desc);
  assert.deepEqual(r.overwritten, [{ field: 'metadesc', live: 'Hand edited in wp-admin', applied: desc }]);
  assert.equal(loadState(theme).pages[0].seo.appliedValues.metadesc, desc);
});

test('applySeo: on a first apply, existing non-empty Yoast values are EEDITED unless forced; equal or empty ones are not', () => {
  const first = harness({ live: { focuskw: 'typed by hand', title: seo.title.value } });
  assert.throws(() => applySeo(first.wp, project(), 'home', seo, { index: false }), (e) => e.code === 'EEDITED' && e.fields.map((f) => f.field).join() === 'focuskw' && e.fields[0].applied === null);
  assert.equal(first.specs.length, 0);
  const forced = harness({ live: { focuskw: 'typed by hand' } });
  applySeo(forced.wp, project(), 'home', seo, { index: false, force: true });
  assert.equal(meta(forced).focuskw, 'emergency plumber');
  const same = harness({ live: { focuskw: 'emergency plumber', metadesc: desc } });
  assert.doesNotThrow(() => applySeo(same.wp, project(), 'home', seo, { index: false }), 'the developer value is the one being applied');
});

test('applySeo: unchanged live values (equal to the last apply) never block a re-apply with new values', () => {
  const h = harness({ live: { metadesc: desc, focuskw: 'emergency plumber' } });
  const theme = project(appliedPage({ metadesc: desc, focuskw: 'emergency plumber' }));
  const newer = { ...seo, focusKeyword: { value: 'austin plumber', inferred: false } };
  applySeo(h.wp, theme, 'home', newer, { index: false });
  assert.equal(meta(h).focuskw, 'austin plumber');
});

test('applySeo: hand-edited JSON-LD is EEDITED; formatting differences are not', () => {
  const applied = JSON.stringify([{ '@type': 'Service', name: 'Emergency plumbing' }]);
  const pretty = harness({ live: { jsonld: JSON.stringify(JSON.parse(applied), null, 4) } });
  assert.doesNotThrow(() => applySeo(pretty.wp, project(appliedPage({ jsonld: applied })), 'home', seo, { index: false }));
  const edited = harness({ live: { jsonld: '[{"@type":"Service","name":"Edited by hand"}]' } });
  assert.throws(() => applySeo(edited.wp, project(appliedPage({ jsonld: applied })), 'home', seo, { index: false }), (e) => e.code === 'EEDITED' && e.fields[0].field === 'jsonld');
});

test('applySeo: a page applied before appliedValues existed compares against its stored seo', () => {
  const legacy = [{ slug: 'home', title: 'Home', status: 'seo', postId: 9, sections: [], seo: { ...seo, applied: APPLIED, ogImageId: null } }];
  const same = harness({ live: { metadesc: desc, focuskw: 'emergency plumber', title: seo.title.value, schema_page_type: 'WebPage', 'opengraph-title': 'Emergency Plumber Austin', 'opengraph-description': desc, 'twitter-title': 'Emergency Plumber Austin', 'twitter-description': desc, jsonld: JSON.stringify(seo.schema.value) } });
  assert.doesNotThrow(() => applySeo(same.wp, project(legacy), 'home', seo, { index: false }));
  const edited = harness({ live: { ...same.store, metadesc: 'Hand edited' } });
  assert.throws(() => applySeo(edited.wp, project(legacy), 'home', seo, { index: false }), (e) => e.code === 'EEDITED' && e.fields.length === 1 && e.fields[0].applied === desc);
});

test('CLI: unknown flags print usage and exit 64', () => {
  for (const args of [['apply', '/t', 'home', 'f.json', '--forse'], ['record-audit', '/t', 'home', 'a.json', '--force'], ['get', '/t', 'home', '--x']]) {
    const r = cli(...args);
    assert.equal(r.status, 64, args.join(' '));
    assert.match(r.stderr, /Usage/);
  }
  assert.equal(cli('get', '/t').status, 64);
});

// ---- residuals: optional social leaves, kept social fields, edit detection ----
const derivedOgTitle = 'Emergency Plumber Austin';

test('validateSeo accepts optional ogTitle, ogDescription, twitterTitle and twitterDescription leaves', () => {
  const social = { ...seo, ogTitle: { value: 'Custom OG', inferred: false }, ogDescription: { value: 'Custom OG description', inferred: true, why: 'shorter for sharing' }, twitterTitle: { value: 'Custom X', inferred: false }, twitterDescription: { value: 'Custom X description', inferred: false } };
  assert.deepEqual(validateSeo(social), []);
  for (const bad of ['', '   ', 42, 'two\nlines']) {
    assert.match(validateSeo({ ...seo, ogTitle: { value: bad, inferred: false } }).join('\n'), /ogTitle/, JSON.stringify(bad));
  }
  assert.match(validateSeo({ ...seo, twitterDescription: { value: 'x', inferred: true } }).join('\n'), /why/);
});

test('buildYoastSpec uses the social leaves when given and derives the rest', () => {
  const spec = buildYoastSpec({ postId: 9, seo: { ...seo, ogTitle: { value: 'Custom OG', inferred: false }, twitterDescription: { value: 'Custom X description', inferred: false } } });
  assert.equal(spec.meta['opengraph-title'], 'Custom OG');
  assert.equal(spec.meta['opengraph-description'], desc);
  assert.equal(spec.meta['twitter-title'], derivedOgTitle);
  assert.equal(spec.meta['twitter-description'], 'Custom X description');
});

test('applySeo keeps a derived social field the developer customised in wp-admin (kept, not EEDITED)', () => {
  const h = harness({ live: { 'opengraph-title': 'Hand-made OG title', 'twitter-description': 'Hand-made X text', metadesc: desc } });
  const theme = project(appliedPage({ 'opengraph-title': derivedOgTitle, 'twitter-description': desc, metadesc: desc }));
  const r = applySeo(h.wp, theme, 'home', seo, { index: false });
  assert.deepEqual(r.kept.sort(), ['opengraph-title', 'twitter-description']);
  assert.equal('opengraph-title' in meta(h), false, 'not written');
  assert.equal('twitter-description' in meta(h), false);
  assert.equal(meta(h)['twitter-title'], derivedOgTitle, 'unedited social fields are still written');
  assert.equal(h.store['opengraph-title'], 'Hand-made OG title');
  assert.equal(loadState(theme).pages[0].seo.appliedValues['opengraph-title'], derivedOgTitle, 'the last applied value stays the baseline');
  const first = harness({ live: { 'opengraph-description': 'Typed before the first apply' } });
  assert.deepEqual(applySeo(first.wp, project(), 'home', seo, { index: false }).kept, ['opengraph-description'], 'first apply: kept too');
});

test('applySeo: a social leaf or force overrides a customised social field; a leaf equal to the live value is no conflict', () => {
  const live = { 'opengraph-title': 'Hand-made OG title' };
  const applied = () => project(appliedPage({ 'opengraph-title': derivedOgTitle }));
  const leaf = harness({ live });
  assert.throws(() => applySeo(leaf.wp, applied(), 'home', { ...seo, ogTitle: { value: 'Another OG title', inferred: false } }, { index: false }), (e) => e.code === 'EEDITED' && e.fields[0].field === 'opengraph-title');
  const same = harness({ live });
  const r = applySeo(same.wp, applied(), 'home', { ...seo, ogTitle: { value: 'Hand-made OG title', inferred: false } }, { index: false });
  assert.equal(meta(same)['opengraph-title'], 'Hand-made OG title');
  assert.equal('kept' in r, false);
  const forced = harness({ live });
  const f = applySeo(forced.wp, applied(), 'home', seo, { index: false, force: true });
  assert.equal(meta(forced)['opengraph-title'], derivedOgTitle);
  assert.equal('kept' in f, false);
  assert.deepEqual(f.overwritten.map((x) => x.field), ['opengraph-title']);
});

test('applySeo: a value cleared in wp-admin after the skill applied it is EEDITED', () => {
  const h = harness({ live: { metadesc: '' } });
  assert.throws(() => applySeo(h.wp, project(appliedPage({ metadesc: desc })), 'home', seo, { index: false }), (e) => e.code === 'EEDITED' && e.fields[0].field === 'metadesc' && e.fields[0].live === '' && e.fields[0].applied === desc);
  assert.deepEqual(seoGet(harness({ live: { metadesc: '' } }).wp, project(appliedPage({ metadesc: desc })), 'home').edited.map((e) => e.field), ['metadesc']);
});

test('applySeo: no no-logo warning when the site keeps its existing logo', () => {
  const noLogo = { ...seo, organization: { value: { name: 'New Co' }, inferred: false } };
  const withLogo = harness({ site: { siteName: 'Acme', sep: '-', organization: { represents: 'company', name: '', logoId: 5 } } });
  assert.equal('warnings' in applySeo(withLogo.wp, project(), 'home', noLogo, { index: false }), false, 'Yoast keeps logo 5');
  const forced = harness({ site: { siteName: 'Acme', sep: '-', organization: { represents: 'company', name: 'Old Co', logoId: 5 } } });
  assert.ok(applySeo(forced.wp, project(), 'home', noLogo, { index: false, forceOrganization: true }).warnings.some((w) => /no logo/.test(w)), 'forced without a logo clears it');
});

test('recordAudit compares the focus keyword trimmed, lowercased and NFC-normalised', () => {
  const theme = project([{ slug: 'home', title: 'Home', status: 'seo', postId: 9, url: PAGE_URL, sections: [], seo: { focusKeyword: { value: 'café austin', inferred: false }, applied: APPLIED } }]);
  assert.equal(recordAudit(theme, 'home', auditFile(audit({ focusKeyword: '  Café Austin ' }))).status, 'done');
});
