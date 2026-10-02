import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditExtract } from '../../skills/protoblocks-site-builder/scripts/qa/seo-audit.mjs';

const good = () => ({
  url: 'http://a.local/emergency-plumber/',
  title: 'Emergency Plumber Austin - Acme',
  metaDescription: 'Licensed emergency plumber in Austin available 24/7. Upfront pricing, same-day repairs and a 1-year guarantee on every job we do here.',
  canonical: 'http://a.local/emergency-plumber/',
  og: { title: 'x', description: 'y', image: 'http://a.local/og.png', url: 'http://a.local/emergency-plumber/' },
  h: [{ level: 1, text: 'Emergency plumber in Austin', selector: 'h1' }, { level: 2, text: 'Services', selector: 'h2' }],
  firstParagraph: 'When a pipe bursts you need an emergency plumber fast — we answer in 60 seconds.',
  imgs: [{ src: '/a.png', alt: 'Van' }, { src: '/b.png', alt: '' }],
  links: [{ href: '/contact/', internal: true }],
  jsonld: [JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': ['WebPage'], name: 'x', url: 'y' }, { '@type': 'Organization', name: 'Acme', url: 'z' }] })],
});
const og = { ok: true, status: 200, width: 1200, height: 630 };
const KW = 'emergency plumber';
const run = (e, o = og, focusKeyword = KW) => auditExtract(e, { focusKeyword, ogImageInfo: o });
const byId = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
const status = (e, id, o) => byId(run(e, o))[id];

test('a good page passes every check', () => {
  const r = run(good());
  assert.equal(r.pass, true, JSON.stringify(r.checks, null, 2));
  assert.deepEqual(r.checks.map((c) => c.id), ['h1-count', 'heading-order', 'kw-title', 'kw-h1', 'kw-first-paragraph', 'kw-description', 'kw-slug', 'title-length', 'description-length', 'img-alt', 'internal-link', 'jsonld-parse', 'jsonld-required', 'og-tags', 'og-image', 'canonical']);
  assert.ok(r.checks.every((c) => c.status === 'pass'));
});

test('two h1s, missing alt, long title fail with details', () => {
  const e = good();
  e.h.push({ level: 1, text: 'Another', selector: 'section#pb-s3 h1' });
  e.imgs.push({ src: '/c.png', alt: null });
  e.title = 'Emergency Plumber Austin — the most reliable, fastest plumbing team in Texas';
  const r = run(e);
  const s = byId(r);
  assert.equal(r.pass, false);
  assert.equal(s['h1-count'], 'fail');
  assert.equal(s['img-alt'], 'fail');
  assert.equal(s['title-length'], 'fail');
  assert.match(r.checks.find((c) => c.id === 'h1-count').detail, /pb-s3/);
});

test('malformed JSON-LD and missing required props are reported, not thrown', () => {
  const e = good();
  e.jsonld = ['{not json', JSON.stringify({ '@type': 'Event', name: 'Open day' })];
  const s = byId(run(e));
  assert.equal(s['jsonld-parse'], 'fail');
  assert.equal(s['jsonld-required'], 'fail');
});

test('keyword missing from slug is only a warning; wrong OG size fails', () => {
  const e = good();
  e.url = 'http://a.local/home/';
  const r = run(e, { ok: true, status: 200, width: 800, height: 600 });
  const s = byId(r);
  assert.equal(s['kw-slug'], 'warn');
  assert.equal(s['og-image'], 'fail');
});

test('skipped heading level is a warning', () => {
  const e = good();
  e.h = [{ level: 1, text: 'Emergency plumber', selector: 'h1' }, { level: 3, text: 'x', selector: 'h3' }];
  assert.equal(status(e, 'heading-order'), 'warn');
});

test('h1-count: zero h1 fails, one passes', () => {
  const e = good();
  e.h = [{ level: 2, text: 'Emergency plumber', selector: 'h2' }];
  assert.equal(status(e, 'h1-count'), 'fail');
  assert.equal(status(good(), 'h1-count'), 'pass');
});

test('heading-order: going back up levels is fine', () => {
  const e = good();
  e.h = [{ level: 1, text: 'Emergency plumber', selector: 'h1' }, { level: 2, text: 'a', selector: 'h2' }, { level: 3, text: 'b', selector: 'h3' }, { level: 2, text: 'c', selector: 'h2' }];
  assert.equal(status(e, 'heading-order'), 'pass');
});

test('kw-title fails when the keyword is absent', () => {
  const e = good();
  e.title = 'Plumbing in Austin - Acme';
  assert.equal(status(e, 'kw-title'), 'fail');
});

test('kw-h1 fails when no h1 has the keyword', () => {
  const e = good();
  e.h[0].text = 'Plumbing in Austin';
  assert.equal(status(e, 'kw-h1'), 'fail');
});

test('kw-first-paragraph fails when the keyword is absent', () => {
  const e = good();
  e.firstParagraph = 'When a pipe bursts you need a plumber fast, we answer in 60 seconds.';
  assert.equal(status(e, 'kw-first-paragraph'), 'fail');
});

test('kw-description fails when the keyword is absent (and when description is null)', () => {
  const e = good();
  e.metaDescription = 'Licensed plumber in Austin available 24/7. Upfront pricing, same-day repairs and a 1-year guarantee on every job we do here, always.';
  assert.equal(status(e, 'kw-description'), 'fail');
  e.metaDescription = null;
  assert.equal(status(e, 'kw-description'), 'fail');
});

test('kw-slug warns when only some keyword words are in the slug, passes when all are', () => {
  const e = good();
  e.url = 'http://a.local/plumber/';
  assert.equal(status(e, 'kw-slug'), 'warn');
  e.url = 'http://a.local/best-emergency-plumber-austin/';
  assert.equal(status(e, 'kw-slug'), 'pass');
});

test('title-length: 60 passes, 61 fails, empty fails', () => {
  const e = good();
  e.title = `emergency plumber ${'x'.repeat(60 - 18)}`;
  assert.equal(e.title.length, 60);
  assert.equal(status(e, 'title-length'), 'pass');
  e.title += 'x';
  assert.equal(status(e, 'title-length'), 'fail');
  e.title = '';
  assert.equal(status(e, 'title-length'), 'fail');
});

test('description-length: 119 and 157 fail, 120 and 156 pass', () => {
  const mk = (n) => `emergency plumber ${'x'.repeat(n - 18)}`;
  const e = good();
  for (const [n, want] of [[119, 'fail'], [120, 'pass'], [156, 'pass'], [157, 'fail']]) {
    e.metaDescription = mk(n);
    assert.equal(e.metaDescription.length, n);
    assert.equal(status(e, 'description-length'), want, `len ${n}`);
  }
});

test('img-alt: null alt fails, empty alt passes', () => {
  const e = good();
  assert.equal(status(e, 'img-alt'), 'pass');
  e.imgs = [{ src: '/c.png', alt: null }];
  assert.equal(status(e, 'img-alt'), 'fail');
});

test('internal-link is a warning when there are only external links', () => {
  const e = good();
  e.links = [{ href: 'https://x.com', internal: false }];
  const r = run(e);
  assert.equal(byId(r)['internal-link'], 'warn');
  assert.equal(r.pass, true);
});

test('jsonld-parse fails when there is no JSON-LD at all', () => {
  const e = good();
  e.jsonld = [];
  assert.equal(status(e, 'jsonld-parse'), 'fail');
});

test('jsonld-required: empty-string and empty-array props count as missing', () => {
  const e = good();
  e.jsonld = [JSON.stringify({ '@type': 'FAQPage', mainEntity: [] }), JSON.stringify({ '@type': 'Organization', name: '', url: 'z' })];
  const r = run(e);
  assert.equal(byId(r)['jsonld-required'], 'fail');
  const d = r.checks.find((c) => c.id === 'jsonld-required').detail;
  assert.match(d, /FAQPage\.mainEntity/);
  assert.match(d, /Organization\.name/);
});

test('jsonld-required: unknown types are ignored', () => {
  const e = good();
  e.jsonld = [JSON.stringify({ '@type': 'Thing' })];
  assert.equal(status(e, 'jsonld-required'), 'pass');
});

test('og-tags fails per missing tag and names it', () => {
  for (const k of ['title', 'description', 'image', 'url']) {
    const e = good();
    e.og[k] = null;
    const r = run(e);
    assert.equal(byId(r)['og-tags'], 'fail', k);
    assert.match(r.checks.find((c) => c.id === 'og-tags').detail, new RegExp(`og:${k}`));
  }
});

test('og-image fails on 404, on null info, and on wrong width or height separately', () => {
  assert.equal(status(good(), 'og-image', { ok: false, status: 404, width: 0, height: 0 }), 'fail');
  assert.equal(status(good(), 'og-image', null), 'fail');
  assert.equal(status(good(), 'og-image', { ok: false, status: 404, width: 1200, height: 630 }), 'fail');
  assert.equal(status(good(), 'og-image', { ok: true, status: 200, width: 1200, height: 600 }), 'fail');
  assert.equal(status(good(), 'og-image', { ok: true, status: 200, width: 1000, height: 630 }), 'fail');
  assert.equal(status(good(), 'og-image', og), 'pass');
});

test('canonical fails when missing', () => {
  const e = good();
  e.canonical = null;
  assert.equal(status(e, 'canonical'), 'fail');
});

test('keyword matching is case-insensitive and spans whitespace and newlines', () => {
  const e = good();
  e.title = 'EMERGENCY   PLUMBER Austin';
  e.h[0].text = 'Emergency\n  Plumber in Austin';
  e.firstParagraph = 'We are your Emergency\nplumber when it matters, day or night, rain or shine.';
  e.metaDescription = `Licensed EMERGENCY\tPLUMBER in Austin available 24/7. Upfront pricing, same-day repairs and a 1-year guarantee on every job we do here.`;
  const s = byId(run(e, og, 'Emergency  Plumber'));
  for (const id of ['kw-title', 'kw-h1', 'kw-first-paragraph', 'kw-description']) assert.equal(s[id], 'pass', id);
});

test('JSON-LD nodes nested inside other nodes and @graph are found', () => {
  const e = good();
  e.jsonld = [JSON.stringify({ '@type': 'WebPage', name: 'x', url: 'y', mainEntity: { '@graph': [{ '@type': 'FAQPage' }] } })];
  const r = run(e);
  assert.equal(byId(r)['jsonld-required'], 'fail');
  assert.match(r.checks.find((c) => c.id === 'jsonld-required').detail, /FAQPage\.mainEntity/);
});

test('malformed block next to a valid one reports the parse failure and still checks the valid node', () => {
  const e = good();
  e.jsonld = ['{not json', JSON.stringify({ '@type': 'Event', name: 'Open day' })];
  const r = run(e);
  const parse = r.checks.find((c) => c.id === 'jsonld-parse');
  assert.equal(parse.status, 'fail');
  const req = r.checks.find((c) => c.id === 'jsonld-required');
  assert.equal(req.status, 'fail');
  assert.match(req.detail, /Event\.startDate/);
});

test('pass is false iff a check fails; warnings never fail', () => {
  const e = good();
  e.url = 'http://a.local/home/';
  e.links = [];
  e.h = [{ level: 1, text: 'Emergency plumber', selector: 'h1' }, { level: 3, text: 'x', selector: 'h3' }];
  const r = run(e);
  assert.deepEqual(r.checks.filter((c) => c.status === 'warn').map((c) => c.id).sort(), ['heading-order', 'internal-link', 'kw-slug']);
  assert.equal(r.pass, true);
  e.canonical = null;
  const r2 = run(e);
  assert.equal(r2.pass, false);
  assert.equal(r2.pass, r2.checks.every((c) => c.status !== 'fail'));
});

test('failing checks carry a fix; passing ones do not', () => {
  const e = good();
  e.canonical = null;
  const r = run(e);
  assert.ok(r.checks.find((c) => c.id === 'canonical').fix);
  assert.equal('fix' in r.checks.find((c) => c.id === 'kw-title'), false);
});

test('JSON-LD @type of constructor/toString does not throw or count as known types', () => {
  const e = good();
  e.jsonld = [JSON.stringify({ '@type': ['constructor', 'toString', '__proto__', 'hasOwnProperty'], name: 'x' })];
  const r = run(e);
  assert.equal(byId(r)['jsonld-required'], 'pass');
});

test('kw-slug matches keyword words as prefixes of slug tokens and ignores words under 3 chars', () => {
  const r = (url) => { const x = good(); x.url = url; return byId(auditExtract(x, { focusKeyword: 'a plumber in austin', ogImageInfo: og }))['kw-slug']; };
  assert.equal(r('http://a.local/austin-plumbers/'), 'pass');
  assert.equal(r('http://a.local/home/'), 'warn');
  assert.equal(r('http://a.local/services/austin/plumbers'), 'pass');
});

test('kw-slug does not match mid-token substrings', () => {
  const x = good();
  x.url = 'http://a.local/unplumbered/';
  assert.equal(byId(auditExtract(x, { focusKeyword: 'plumber', ogImageInfo: og }))['kw-slug'], 'warn');
});

test('empty or whitespace keyword fails every kw-* check with "no focus keyword"', () => {
  for (const kw of ['', '   \n', undefined]) {
    const r = auditExtract(good(), { focusKeyword: kw, ogImageInfo: og });
    assert.equal(r.pass, false);
    for (const id of ['kw-title', 'kw-h1', 'kw-first-paragraph', 'kw-description', 'kw-slug']) {
      const c = r.checks.find((x) => x.id === id);
      assert.equal(c.status, 'fail', id);
      assert.equal(c.detail, 'no focus keyword', id);
    }
  }
});
