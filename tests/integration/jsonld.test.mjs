import assert from 'node:assert/strict';
import { itest, testWp, SITE_URL } from './helpers.mjs';
import { jsonldSupported, JSONLD_META_KEY } from '../../skills/protoblocks-site-builder/scripts/lib/jsonld.mjs';

const graphOf = async (slug) => {
  const html = await (await fetch(`${SITE_URL}/${slug}/`)).text();
  const m = html.match(/<script type="application\/ld\+json" class="yoast-schema-graph">(.*?)<\/script>/s);
  assert.ok(m, `Yoast schema graph present on /${slug}/`);
  return JSON.parse(m[1])['@graph'];
};
const webPage = (graph) => graph.find((p) => [].concat(p['@type']).includes('WebPage'));

itest('theme JSON-LD extension merges _proto_jsonld into the Yoast graph', async (t) => {
  const wp = testWp();
  if (!jsonldSupported(wp)) { t.skip('active theme lacks the Yoast JSON-LD extension (proto-blocks-theme feat/yoast-jsonld)'); return; }
  const stamp = Date.now();
  const ids = [];
  const mk = (slug, title) => {
    const id = wp.check(['post', 'create', '--post_type=page', '--post_status=publish', `--post_name=${slug}`, `--post_title=${title}`, '--porcelain']).trim();
    ids.push(id);
    return id;
  };
  try {
    const slug = `pb-jsonld-${stamp}`;
    const id = mk(slug, 'JSON-LD Test');
    const nodes = [{ '@type': 'FAQPage', mainEntity: [{ '@id': '#q1' }] }, { '@type': 'Question', '@id': '#q1', name: 'Why?', acceptedAnswer: { '@type': 'Answer', text: 'Because.' } }];
    wp.check(['post', 'meta', 'update', id, JSONLD_META_KEY, JSON.stringify(nodes)]);
    const graph = await graphOf(slug);
    assert.ok([].concat(webPage(graph)['@type']).includes('FAQPage'));
    assert.ok(graph.some((p) => p['@type'] === 'Question' && p['@id'].endsWith('#q1')));

    // No bleed: a second page without meta must not get the first page's nodes.
    const otherSlug = `pb-jsonld-plain-${stamp}`;
    mk(otherSlug, 'JSON-LD Plain');
    const other = await graphOf(otherSlug);
    assert.ok(webPage(other), 'plain page keeps its Yoast WebPage');
    assert.ok(![].concat(webPage(other)['@type']).includes('FAQPage'), 'FAQPage must not bleed onto the plain page');
    assert.ok(!other.some((p) => p['@type'] === 'Question'), 'Question must not bleed onto the plain page');

    // Invalid JSON in the meta: the page still renders Yoast's normal graph.
    const badSlug = `pb-jsonld-bad-${stamp}`;
    const badId = mk(badSlug, 'JSON-LD Bad');
    wp.check(['post', 'meta', 'update', badId, JSONLD_META_KEY, '{not valid json']);
    const badGraph = await graphOf(badSlug);
    assert.ok(webPage(badGraph), 'Yoast WebPage still rendered');
    assert.ok(![].concat(webPage(badGraph)['@type']).includes('FAQPage'));
    assert.ok(!badGraph.some((p) => p['@type'] === 'Question'));
  } finally {
    for (const id of ids) wp.check(['post', 'delete', id, '--force']);
  }
});
