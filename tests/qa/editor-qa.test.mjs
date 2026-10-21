import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

// The editor audit against a fake block editor (tests/qa/fixtures/editor.html): the wp.data stores, Proto-Blocks'
// localized data and admin-ajax preview, the canvas iframe and the inspector, with no WordPress. Logging in, the QA
// user and the Site Editor need a site: the e2e test covers them.
const load = async () => ({ ...(await import(path.join(QA_DIR, 'editor-qa.mjs'))), ...(await import(path.join(QA_DIR, 'browser.mjs'))) });
const FAST = { timeoutMs: 8000, previewWaitMs: 1500, inspectorWaitMs: 1000 };

const HERO = { title: 'Hero Split', protoBlocks: { fields: { heading: { type: 'text' }, image: { type: 'image' }, cta: { type: 'link' } }, controls: { align: { type: 'select', options: ['l', 'r'] } } } };
const GRID = { title: 'Feature Grid', protoBlocks: { fields: { heading: { type: 'text' }, cards: { type: 'repeater', fields: { title: { type: 'text' }, link: { type: 'link' } }, itemControls: { tone: { type: 'select', options: ['a'] } } }, body: { type: 'inner-blocks' } }, controls: {} } };
const HERO_HTML = '<section class="hero"><h1 data-proto-field="heading">Hi</h1><img data-proto-field="image" src=""><a data-proto-field="cta" href="#">Go</a></section>';
const GRID_HTML = '<section><h2 data-proto-field="heading">Features</h2><div data-proto-repeater="cards"><a class="card" data-proto-repeater-item href="#"><h3 data-proto-field="title">A</h3></a></div><div data-proto-inner-blocks></div></section>';

function themeWith(defs) {
  const theme = tmpDir('pb-editorqa-theme-');
  for (const [slug, json] of Object.entries(defs)) {
    fs.mkdirSync(path.join(theme, 'proto-blocks', slug), { recursive: true });
    fs.writeFileSync(path.join(theme, 'proto-blocks', slug, 'block.json'), JSON.stringify(json));
  }
  return theme;
}

const baseConfig = () => ({
  blocks: [
    { name: 'proto-blocks/hero-split', clientId: 'c1', attributes: { anchor: 'pb-s1', heading: 'Hi', align: 'l', className: 'x' } },
    { name: 'proto-blocks/feature-grid', clientId: 'c2', attributes: { anchor: 'pb-s2', heading: 'Features', cards: [{ title: 'A' }] } },
  ],
  canvas: [{ clientId: 'c1', name: 'proto-blocks/hero-split', html: '<h1 class="block-editor-rich-text__editable" contenteditable="true">Hi</h1>' }, { clientId: 'c2', name: 'proto-blocks/feature-grid', html: '<h2>Features</h2><div class="proto-blocks-inner-blocks"></div>' }],
  previews: { 'hero-split': HERO_HTML, 'feature-grid': GRID_HTML },
  titles: { 'hero-split': 'Hero Split', 'feature-grid': 'Feature Grid' },
  panels: { 'hero-split': 1, 'feature-grid': 0 },
});

async function audit(config, { expected = ['pb-s1', 'pb-s2'], defs = { 'hero-split': HERO, 'feature-grid': GRID }, themeDir } = {}) {
  const { auditEditor, launchBrowser } = await load();
  const srv = await serveFixtures();
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addInitScript((c) => { window.__editorConfig = c; }, config);
    const page = await context.newPage();
    const outDir = path.join(tmpDir(), 'out');
    const result = await auditEditor(page, { url: `${srv.url}/editor.html`, expected, themeDir: themeDir ?? themeWith(defs), outDir, ...FAST });
    const requests = await page.evaluate(() => window.__requests);
    const selected = await page.evaluate(() => window.__selected);
    const prefs = await page.evaluate(() => window.__prefs ?? []);
    await context.close();
    return { result, requests, selected, prefs, outDir };
  } finally {
    await browser.close();
    await srv.close();
  }
}

qtest('collectBindings counts fields, repeater items and subfields, link items and inner blocks in preview markup', async () => {
  const { collectBindings, launchBrowser } = await load();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const run = (html) => page.evaluate(({ html, src }) => new Function(`return (${src})`)()(new DOMParser().parseFromString(html, 'text/html').body), { html, src: collectBindings.toString() });
    assert.deepEqual(await run(HERO_HTML), { fields: { heading: 1, image: 1, cta: 1 }, repeaters: {}, innerBlocks: 0 });
    assert.deepEqual(await run(GRID_HTML), { fields: { heading: 1, title: 1 }, repeaters: { cards: { items: 1, fields: { title: 1 }, linkItems: 1 } }, innerBlocks: 1 });
    // Icon-only link inside the item, two items, an empty repeater.
    const html = '<ul data-proto-repeater="items"><li data-proto-repeater-item><span data-proto-field="label">a</span><a href="#"><svg></svg></a></li><li data-proto-repeater-item><span data-proto-field="label">b</span></li></ul><div data-proto-repeater="empty"></div>';
    assert.deepEqual(await run(html), { fields: { label: 2 }, repeaters: { items: { items: 2, fields: { label: 2 }, linkItems: 1 }, empty: { items: 0, fields: {}, linkItems: 0 } }, innerBlocks: 0 });
  } finally { await browser.close(); }
});

qtest('auditEditor passes a clean editor: sections in order, previews bound (whole-card link via the toolbar), inspector shown, not dirty, screenshots written', async () => {
  const { result: r, requests, selected, prefs, outDir } = await audit(baseConfig());
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
  assert.deepEqual([r.loaded, r.canvas, r.dirty, r.pageErrors], [true, 'iframe', false, []]);
  assert.deepEqual(r.sections, { expected: ['pb-s1', 'pb-s2'], found: ['pb-s1', 'pb-s2'], missing: [], extra: [], duplicates: [], order: true, pass: true });
  const [hero, grid] = r.blocks;
  assert.deepEqual([hero.anchor, hero.name, hero.proto, hero.isValid, hero.rendered, hero.definition], ['pb-s1', 'proto-blocks/hero-split', true, true, true, 'block.json']);
  assert.deepEqual(hero.fields, { declared: ['heading', 'image', 'cta'], bound: ['heading', 'image', 'cta'], missing: [], toolbar: [], hints: [] });
  assert.deepEqual(hero.canvas, { editable: 1, innerBlocks: 0, linkFields: 0 });
  assert.deepEqual([hero.inspector.title, hero.inspector.panels, hero.inspector.controls, hero.inspector.declaredControls, hero.inspector.pass], ['Hero Split', 1, 1, 1, true]);
  assert.deepEqual(hero.preview.status, 200);
  assert.deepEqual(grid.fields, { declared: ['heading', 'cards', 'cards.title', 'cards.link', 'body'], bound: ['heading', 'cards', 'cards.title', 'cards.link', 'body'], missing: [], toolbar: ['cards.link'], hints: [] });
  assert.deepEqual([grid.inspector.panels, grid.inspector.declaredControls, grid.inspector.pass], [0, 0, true]);
  // The preview is requested as the editor requests it: the block slug, only field and control attributes (no anchor).
  assert.deepEqual(requests.map((q) => [q.action, q.template, q.nonce, JSON.parse(q.attributes)]), [
    ['proto_blocks_preview', 'hero-split', 'nonce-1', { heading: 'Hi', align: 'l' }],
    ['proto_blocks_preview', 'feature-grid', 'nonce-1', { heading: 'Features', cards: [{ title: 'A' }] }],
  ]);
  assert.deepEqual(selected, ['c1', 'c2'], 'every proto block is selected');
  assert.ok(prefs.some(([scope, key, v]) => scope === 'core/edit-post' && key === 'welcomeGuide' && v === false), 'welcome guide dismissed through preferences');
  assert.deepEqual(r.screenshots, { editor: path.join(outDir, 'editor.png'), inspector: path.join(outDir, 'inspector.png') });
  for (const f of Object.values(r.screenshots)) assert.ok(fs.statSync(f).size > 0, f);
});

qtest('auditEditor fails on an unbound field, an empty repeater (seeding hint), an error notice, an invalid block, extra and missing blocks, and a dirty post', async () => {
  // Unbound field + repeater without items + a core block at the top level + a section missing.
  const c = baseConfig();
  c.previews['hero-split'] = '<section><h1 data-proto-field="heading">Hi</h1></section>';
  c.previews['feature-grid'] = '<section><h2 data-proto-field="heading">F</h2><div data-proto-repeater="cards"></div><div data-proto-inner-blocks></div></section>';
  c.blocks.push({ name: 'core/paragraph', clientId: 'c3', attributes: {} });
  c.canvas.push({ clientId: 'c3', name: 'core/paragraph', html: '<p>stray</p>' });
  let { result: r } = await audit(c, { expected: ['pb-s1', 'pb-s2', 'pb-s3'] });
  assert.equal(r.pass, false);
  assert.deepEqual(r.blocks[0].fields.missing, ['image', 'cta']);
  assert.deepEqual(r.blocks[1].fields.missing, ['cards.title', 'cards.link']);
  assert.match(r.blocks[1].fields.hints[0], /seed a placeholder item under \$is_preview/);
  assert.deepEqual([r.blocks[2].proto, r.blocks[2].isValid, r.blocks[2].fields], [false, true, undefined]);
  assert.deepEqual([r.sections.missing, r.sections.extra, r.sections.pass], [['pb-s3'], [{ name: 'core/paragraph', anchor: null }], false]);
  // Error notice in the canvas, an invalid block, a wrong inspector title, a dirty post.
  const d = baseConfig();
  d.canvas[0].html = '<div class="proto-blocks-error"><strong>Error:</strong> Template file not found.</div>';
  d.blocks[1].isValid = false;
  d.titles['feature-grid'] = 'Something Else';
  d.dirty = 'select';
  ({ result: r } = await audit(d));
  assert.equal(r.pass, false);
  assert.deepEqual([r.blocks[0].rendered, r.blocks[0].renderError], [false, 'Error: Template file not found.']);
  assert.equal(r.blocks[1].isValid, false);
  assert.deepEqual([r.blocks[1].inspector.title, r.blocks[1].inspector.expectedTitle, r.blocks[1].inspector.pass], ['Something Else', 'Feature Grid', false]);
  assert.equal(r.dirty, true, 'selecting blocks dirtied the post');
  // Core's own error notice text, a wrapper still loading, a wrapper that never rendered.
  const e = baseConfig();
  e.canvas[0].html = '<div class="block-editor-warning">This block has encountered an error and cannot be previewed.</div>';
  e.canvas[1] = { clientId: 'c2', name: 'proto-blocks/feature-grid', html: '<div class="proto-blocks-loading">Loading preview...</div>' };
  ({ result: r } = await audit(e));
  assert.deepEqual([r.blocks[0].rendered, r.blocks[1].rendered, r.blocks[1].renderError, r.pass], [false, false, 'the preview is still loading', false]);
  const g = baseConfig();
  g.canvas = [g.canvas[0]];
  ({ result: r } = await audit(g));
  assert.deepEqual([r.blocks[1].rendered, r.blocks[1].renderError], [false, 'no [data-block] wrapper in the canvas']);
});

qtest('auditEditor reports a failed preview request, a missing protoBlocksData, and falls back to the localized block definition', async () => {
  const c = baseConfig();
  c.previews['hero-split'] = { error: 'Template file not found.' };
  delete c.previews['feature-grid'];
  let { result: r } = await audit(c);
  assert.equal(r.pass, false);
  assert.deepEqual([r.blocks[0].preview.status, r.blocks[0].preview.error], [500, 'Template file not found.']);
  assert.deepEqual(r.blocks[0].fields.missing, ['heading', 'image', 'cta']);
  assert.match(r.blocks[0].fields.hints.join(), /the editor preview request failed: Template file not found\./);
  assert.deepEqual([r.blocks[1].preview.status, r.blocks[1].preview.error], [404, 'Block template not found.']);
  const n = baseConfig();
  n.noProtoData = true;
  ({ result: r } = await audit(n));
  assert.match(r.blocks[0].preview.error, /protoBlocksData has no ajaxUrl/);
  assert.equal(r.pass, false);
  // No block.json in the fork: the plugin's localized definition is used (fields, controls, title); none at all: no comparison.
  const l = baseConfig();
  l.localized = [{ name: 'hero-split', title: 'Hero Split', fields: HERO.protoBlocks.fields, controls: HERO.protoBlocks.controls }];
  ({ result: r } = await audit(l, { defs: { 'feature-grid': GRID } }));
  assert.deepEqual([r.blocks[0].definition, r.blocks[0].fields.missing, r.blocks[0].inspector.pass, r.blocks[1].definition], ['protoBlocksData', [], true, 'block.json']);
  assert.equal(r.pass, true, JSON.stringify(r.blocks[0]));
  ({ result: r } = await audit(baseConfig(), { defs: { 'feature-grid': GRID } }));
  assert.deepEqual([r.blocks[0].definition, r.blocks[0].fields.declared, r.blocks[0].fields.missing], [null, [], []]);
  assert.match(r.blocks[0].fields.hints[0], /no block\.json found/);
  assert.equal(r.blocks[0].inspector.expectedTitle, null);
});

qtest('auditEditor: an inline (non-iframe) canvas works; an editor that never loads blocks fails with loaded false', async () => {
  const c = baseConfig();
  c.inline = true;
  let { result: r } = await audit(c);
  assert.deepEqual([r.canvas, r.pass], ['document', true]);
  const empty = baseConfig();
  empty.blocks = [];
  ({ result: r } = await audit(empty, { expected: [] }));
  assert.deepEqual([r.loaded, r.pass, r.canvas, r.blocks], [false, false, null, []]);
  assert.match(r.error, /did not load any block within 8000 ms/);
  const noWp = baseConfig();
  noWp.noWp = true;
  ({ result: r } = await audit(noWp));
  assert.deepEqual([r.loaded, r.pass], [false, false]);
});
