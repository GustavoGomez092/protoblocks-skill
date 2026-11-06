import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  A11Y_TAGS, BLOCKING_IMPACTS, BLOCKING_RULES, SKIP_LINK_SELECTOR, NO_TAXI_WARNING,
  filterViolations, trimViolation, mergeViewports, a11yBlockers, blockingRulesFrom, checkSectionA11y,
} from '../../skills/protoblocks-site-builder/scripts/qa/a11y.mjs';
import * as pageQa from '../../skills/protoblocks-site-builder/scripts/qa/page-qa.mjs';

const SCRIPT = new URL('../../skills/protoblocks-site-builder/scripts/qa/a11y.mjs', import.meta.url).pathname;

test('tags add WCAG 2.2 and best-practice; the moderate blocking list is the five landmark/heading/region rules', () => {
  assert.deepEqual(A11Y_TAGS, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice']);
  assert.deepEqual(BLOCKING_IMPACTS, ['serious', 'critical']);
  assert.deepEqual(BLOCKING_RULES, ['landmark-unique', 'landmark-no-duplicate-main', 'landmark-main-is-top-level', 'heading-order', 'region']);
  assert.equal(SKIP_LINK_SELECTOR, '#wp-skip-link');
  assert.match(NO_TAXI_WARNING, /theme has no Taxi/);
});

test('page-qa.mjs still exports filterViolations (the same function)', async () => {
  const a11y = await import('../../skills/protoblocks-site-builder/scripts/qa/a11y.mjs');
  assert.equal(pageQa.filterViolations, a11y.filterViolations);
});

test('filterViolations blocks the moderate rules on the list; the site.qa override replaces the list', () => {
  const v = [
    { id: 'landmark-unique', impact: 'moderate', nodes: [{ target: ['header nav nav'] }] },
    { id: 'heading-order', impact: 'moderate', nodes: [{ target: ['main h3'] }] },
    { id: 'target-size', impact: 'serious', nodes: [{ target: ['#pb-s3 button'] }] },
    { id: 'empty-table-header', impact: 'minor', nodes: [{ target: ['main th'] }] },
  ];
  const def = filterViolations(v);
  assert.deepEqual(def.blocking.map((x) => x.id), ['landmark-unique', 'heading-order', 'target-size']);
  assert.deepEqual(def.other.map((x) => x.id), ['empty-table-header']);
  const over = filterViolations(v, { blockingRules: ['heading-order'] });
  assert.deepEqual(over.blocking.map((x) => x.id), ['heading-order', 'target-size'], 'serious/critical always block');
  assert.deepEqual(over.other.map((x) => x.id), ['landmark-unique', 'empty-table-header']);
});

test('filterViolations reports region on #wp-skip-link as info, outside the page scopes too, and keeps other region nodes blocking', () => {
  const v = [{ id: 'region', impact: 'moderate', help: 'h', helpUrl: 'u', tags: ['best-practice'], nodes: [
    { target: ['#wp-skip-link'], html: '<a id="wp-skip-link">', inScope: false },
    { target: ['#pb-s2 > div'], html: '<div>' },
    { target: ['#third-party'], html: '<div>' },
  ] }];
  const r = filterViolations(v);
  assert.deepEqual(r.other, [{ id: 'region', impact: 'info', help: 'h', helpUrl: 'u', tags: ['best-practice'], nodes: [{ target: ['#wp-skip-link'], html: '<a id="wp-skip-link">', inScope: false }] }]);
  assert.deepEqual(r.blocking.map((x) => [x.id, x.impact, x.nodes.map((n) => n.target[0])]), [['region', 'moderate', ['#pb-s2 > div']]]);
  // A DOM-resolved flag wins over the selector (a node inside the skip link, or a look-alike id).
  const flagged = filterViolations([{ id: 'region', impact: 'moderate', nodes: [{ target: ['span'], skipLink: true, inScope: false }, { target: ['#wp-skip-link-x'], inScope: true }] }]);
  assert.deepEqual(flagged.other.map((x) => [x.impact, x.nodes[0].target[0]]), [['info', 'span']]);
  assert.deepEqual(flagged.blocking.map((x) => x.nodes[0].target[0]), ['#wp-skip-link-x']);
  // Only `region` gets the exemption.
  assert.deepEqual(filterViolations([{ id: 'skip-link', impact: 'moderate', nodes: [{ target: ['#wp-skip-link'], inScope: true }] }]).other.map((x) => x.impact), ['moderate']);
});

test('trimViolation keeps id, impact, help, helpUrl, tags and up to 5 nodes with a 120-char html snippet', () => {
  const long = `<div class="x">${'y'.repeat(300)}</div>`;
  const t = trimViolation({ id: 'a', impact: 'serious', help: 'h', helpUrl: 'u', tags: ['t'], description: 'dropped', nodes: Array.from({ length: 7 }, (_, i) => ({ target: [`#n${i}`], html: `  ${long}\n `, any: [{ big: true }], inScope: true })) });
  assert.deepEqual(Object.keys(t), ['id', 'impact', 'help', 'helpUrl', 'tags', 'nodes']);
  assert.equal(t.nodes.length, 5);
  assert.equal(t.nodes[0].html.length, 120);
  assert.ok(t.nodes[0].html.startsWith('<div class="x">yyy') && t.nodes[0].html.endsWith('…'));
  assert.deepEqual(Object.keys(t.nodes[0]), ['target', 'html', 'inScope']);
  assert.equal(trimViolation({ id: 'b', nodes: [{ target: ['p'], html: '<p>\n  short\n</p>' }] }).nodes[0].html, '<p> short </p>');
});

test('mergeViewports merges by rule id + first target, carries viewports and the node union (max 5), lists ids per viewport', () => {
  const n = (t) => ({ target: [t], html: `<${t}>` });
  const desktop = { name: 'desktop', width: 1440, blocking: [{ id: 'landmark-unique', nodes: [n('nav')] }, { id: 'target-size', nodes: [n('b1'), n('b2')] }], other: [{ id: 'region', impact: 'info', nodes: [n('#wp-skip-link')] }] };
  const mobile = { name: 'mobile', width: 390, blocking: [{ id: 'target-size', nodes: [n('b1'), n('b3'), n('b4'), n('b5'), n('b6'), n('b7')] }, { id: 'target-size', nodes: [n('menu')] }], other: [{ id: 'region', impact: 'info', nodes: [n('#wp-skip-link')] }] };
  const r = mergeViewports([desktop, mobile]);
  assert.deepEqual(r.blocking.map((v) => [v.id, v.viewports, v.nodes.map((x) => x.target[0])]), [
    ['landmark-unique', ['desktop'], ['nav']],
    ['target-size', ['desktop', 'mobile'], ['b1', 'b2', 'b3', 'b4', 'b5']],
    ['target-size', ['mobile'], ['menu']],
  ]);
  assert.deepEqual(r.other.map((v) => [v.id, v.viewports]), [['region', ['desktop', 'mobile']]]);
  assert.deepEqual(r.byViewport, [
    { name: 'desktop', width: 1440, blocking: ['landmark-unique', 'target-size'], other: ['region'] },
    { name: 'mobile', width: 390, blocking: ['target-size'], other: ['region'] },
  ]);
  assert.deepEqual(mergeViewports([]), { blocking: [], other: [], byViewport: [] });
});

test('a11yBlockers lists axe, patterns, the post-navigation pass and errors; a skipped pass and other items do not block', () => {
  assert.deepEqual(a11yBlockers(undefined), []);
  assert.deepEqual(a11yBlockers({ blocking: [], other: [{ id: 'region' }], patterns: [], afterNavigation: { skipped: true, warning: NO_TAXI_WARNING } }), []);
  assert.deepEqual(a11yBlockers({
    error: 'boom',
    blocking: [{ id: 'landmark-unique' }, { id: 'target-size' }, { id: 'target-size' }],
    patterns: [{ id: 'heading-skip' }, { id: 'heading-skip' }, { id: 'nested-nav' }],
    afterNavigation: { skipped: false, to: 'http://a.local/about/', blocking: [{ id: 'region' }], patterns: [{ id: 'nested-nav' }], ariaCurrent: { pass: false, missing: ['#a'], stale: ['#b', '#c'], hash: ['#cookie-settings'] }, pass: false },
  }), [
    'axe did not run: boom',
    'blocking a11y violations: landmark-unique, target-size',
    'a11y pattern failures: heading-skip, nested-nav',
    'blocking a11y violations after navigating to http://a.local/about/: region',
    'a11y pattern failures after navigating to http://a.local/about/: nested-nav',
    'aria-current="page" wrong after navigating to http://a.local/about/: missing on #a; stale on #b, #c; set on hash links #cookie-settings',
  ]);
  assert.deepEqual(a11yBlockers({ blocking: [], patterns: [], afterNavigation: { skipped: false, from: 'x', to: 'y', error: 'proto:page-ready was not dispatched', pass: false } }), ['post-navigation pass failed: proto:page-ready was not dispatched']);
});

test('blockingRulesFrom: the override when it is a list of rule ids, the built-in list when unset, EINPUT otherwise', () => {
  assert.equal(blockingRulesFrom({}), BLOCKING_RULES);
  assert.equal(blockingRulesFrom(undefined), BLOCKING_RULES);
  assert.deepEqual(blockingRulesFrom({ a11yBlocking: [] }), []);
  assert.deepEqual(blockingRulesFrom({ a11yBlocking: ['heading-order'] }), ['heading-order']);
  for (const bad of ['heading-order', [1], [' '], { a: 1 }]) assert.throws(() => blockingRulesFrom({ a11yBlocking: bad }), (e) => e.code === 'EINPUT', JSON.stringify(bad));
});

test('checkSectionA11y validates anchor and url before opening a browser', async () => {
  await assert.rejects(checkSectionA11y({ url: 'http://a.local/', anchor: '../x' }), (e) => e.code === 'EANCHOR');
  await assert.rejects(checkSectionA11y({ url: 'http://a.local/', anchor: '1abc' }), (e) => e.code === 'EANCHOR');
  await assert.rejects(checkSectionA11y({ url: 'file:///etc/passwd', anchor: 'pb-s1' }), (e) => e.code === 'EINPUT');
  await assert.rejects(checkSectionA11y({ url: 'http://a.local/', anchor: 'pb-s1', width: 0 }), (e) => e.code === 'EINPUT');
});

test('a11y.mjs CLI: usage names check-section and --width and exits 64; a bad anchor is [EANCHOR], exit 1', () => {
  const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
  for (const args of [[], ['nope'], ['check-section', 'http://a.local/'], ['check-section', 'http://a.local/', 'pb-s1', 'extra'], ['check-section', 'http://a.local/', 'pb-s1', '--width'], ['check-section', 'http://a.local/', 'pb-s1', '--width', 'wide'], ['check-section', 'http://a.local/', 'pb-s1', '--force']]) {
    const r = run(...args);
    assert.equal(r.status, 64, JSON.stringify(args));
    assert.match(r.stderr, /check-section <url> <anchor> \[--width N\]/);
  }
  const r = run('check-section', 'http://a.local/', 'bad anchor!');
  assert.deepEqual([r.status, /^\[EANCHOR\]/.test(r.stderr)], [1, true], r.stderr);
});

// ---- site-a11y.mjs ----
const SITE = new URL('../../skills/protoblocks-site-builder/scripts/qa/site-a11y.mjs', import.meta.url).pathname;

test('siteWidths is the union of every page\'s frame widths, widest first; 1440 and 390 when no page has frames', async () => {
  const { siteWidths } = await import(SITE);
  const pages = [
    { design: { frames: [{ breakpoint: 'mobile', width: 390 }, { breakpoint: 'desktop', width: 1440 }] } },
    { design: { frames: [{ breakpoint: 'tablet', width: 768 }, { breakpoint: 'phone', width: 390 }, { width: 'x' }] } },
    {},
  ];
  assert.deepEqual(siteWidths({ pages }), [{ name: 'desktop', width: 1440 }, { name: 'tablet', width: 768 }, { name: 'mobile', width: 390 }]);
  assert.deepEqual(siteWidths({ pages: [{}] }), [{ name: 'desktop', width: 1440 }, { name: 'mobile', width: 390 }]);
});

test('siteTargets: pages with a url, then the 404 probe under the site url; no site url is EINPUT', async () => {
  const { siteTargets } = await import(SITE);
  const t = siteTargets({ site: { url: 'http://a.local/' }, pages: [{ slug: 'home', url: 'http://a.local/' }, { slug: 'draft' }, { slug: 'blank', url: ' ' }] });
  assert.deepEqual(t, [{ slug: 'home', url: 'http://a.local/' }, { slug: '__404__', url: 'http://a.local/__pb-404-probe__', probe: true }]);
  assert.throws(() => siteTargets({ site: { url: 'a.local' }, pages: [] }), (e) => e.code === 'EINPUT');
});

test('site-a11y.mjs CLI: usage names run and --out (exit 64); a missing theme folder is [ENOTHEME]', () => {
  const run = (...a) => spawnSync(process.execPath, [SITE, ...a], { encoding: 'utf8' });
  for (const args of [[], ['nope', '/tmp'], ['run'], ['run', '/tmp', 'extra'], ['run', '/tmp', '--out'], ['run', '/tmp', '--out', '--x'], ['run', '--out', 'f']]) {
    const r = run(...args);
    assert.equal(r.status, 64, JSON.stringify(args));
    assert.match(r.stderr, /site-a11y\.mjs run <themeDir> \[--out file\]/);
  }
  const r = run('run', '/definitely/not/a/theme');
  assert.deepEqual([r.status, /^\[ENOTHEME\]/.test(r.stderr)], [1, true], r.stderr);
});
