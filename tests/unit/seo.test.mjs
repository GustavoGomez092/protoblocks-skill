import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { validateSeo, buildYoastSpec, applySeo, recordAudit, renderTitle, socialTitle } from '../../skills/protoblocks-site-builder/scripts/lib/seo.mjs';

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
function harness({ jsonldSupported = true, indexCode = 0, site = { siteName: 'Acme Plumbing', sep: '-' }, applyReply = null, siteFails = null } = {}) {
  const calls = [];
  const specs = [];
  const exec = (cmd, args) => {
    calls.push(args);
    if (args[0] === 'eval') return { code: 0, stdout: jsonldSupported ? '1' : '0', stderr: '' };
    if (args[0] === 'yoast') return { code: indexCode, stdout: '', stderr: indexCode ? 'boom' : '' };
    if (args[0] === 'eval-file' && args[1].endsWith('media.php')) return { code: 0, stdout: '{"id":77,"url":"u","alt":"a","mime":"image/png","reused":true}\n', stderr: '' };
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php') && args[2] === 'site' && siteFails === 'untyped') return { code: 1, stdout: '', stderr: 'Fatal: no WPSEO_Option_Titles' };
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php') && args[2] === 'site' && siteFails === 'typed') return { code: 0, stdout: '{"error":{"code":"EYOAST","message":"Yoast SEO is not active."}}\n', stderr: '' };
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php') && args[2] === 'site') return { code: 0, stdout: `${JSON.stringify(site)}\n`, stderr: '' };
    if (args[0] === 'eval-file' && args[1].endsWith('yoast.php')) {
      if (applyReply) return { code: 0, stdout: `${JSON.stringify(applyReply)}\n`, stderr: '' };
      specs.push(JSON.parse(fs.readFileSync(args[3], 'utf8')));
      return { code: 0, stdout: '{"postId":9,"written":["focuskw"],"featuredImageSet":false,"organization":"skipped"}\n', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
  };
  return { wp: createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }), calls, specs };
}
function project(pages = [{ slug: 'home', title: 'Home', status: 'seo', postId: 9, sections: [] }]) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-seo-unit-'));
  initState(theme, { url: 'http://x.test', path: '/x' });
  updateState(theme, (s) => { s.pages.push(...pages); });
  return theme;
}
const png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-seo-img-')), 'og.png');
fs.writeFileSync(png, 'x');

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

test('recordAudit: a passing audit sets the page to done and stores the absolute path', () => {
  const theme = project();
  const f = auditFile({ pass: true, checks: [] });
  assert.deepEqual(recordAudit(theme, 'home', f), { pass: true, status: 'done' });
  const p = loadState(theme).pages[0];
  assert.equal(p.status, 'done');
  assert.equal(p.seo.audit.pass, true);
  assert.equal(p.seo.audit.file, path.resolve(f));
});

test('recordAudit: a failing audit keeps the status and stores pass:false; relative paths become absolute', () => {
  const theme = project();
  const f = auditFile({ pass: false, checks: [] });
  const rel = path.relative(process.cwd(), f);
  assert.deepEqual(recordAudit(theme, 'home', rel), { pass: false, status: 'seo' });
  const p = loadState(theme).pages[0];
  assert.equal(p.status, 'seo');
  assert.equal(p.seo.audit.pass, false);
  assert.equal(p.seo.audit.file, f);
});

test('recordAudit: keeps existing seo fields', () => {
  const theme = project([{ slug: 'home', status: 'seo', postId: 9, sections: [], seo: { focusKeyword: seo.focusKeyword } }]);
  recordAudit(theme, 'home', auditFile({ pass: true }));
  assert.equal(loadState(theme).pages[0].seo.focusKeyword.value, 'emergency plumber');
});

test('recordAudit: missing page is ENOPAGE; unreadable or invalid audit is EINPUT and changes nothing', () => {
  const theme = project();
  assert.throws(() => recordAudit(theme, 'nope', auditFile({ pass: true })), code('ENOPAGE'));
  assert.throws(() => recordAudit(theme, 'home', path.join(os.tmpdir(), 'pb-no-such-audit.json')), code('EINPUT'));
  assert.throws(() => recordAudit(theme, 'home', auditFile('{not json')), code('EINPUT'));
  assert.throws(() => recordAudit(theme, 'home', auditFile('[1,2]')), code('EINPUT'));
  assert.throws(() => recordAudit(theme, 'home', auditFile({ checks: [] })), code('EINPUT'));
  const p = loadState(theme).pages[0];
  assert.equal(p.status, 'seo');
  assert.equal(p.seo, undefined);
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
  const theme = project();
  const r = cli('record-audit', theme, 'home', auditFile({ pass: true }));
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).status, 'done');
  const bad = cli('record-audit', theme, 'nope', auditFile({ pass: true }));
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
  const c = harness();
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
