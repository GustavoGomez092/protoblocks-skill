import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { runGates } from '../../skills/protoblocks-site-builder/scripts/lib/gates.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blocks');

// Installs fixture blocks into the throwaway pb-itest theme (never the developer's theme).
async function install(wp, name) {
  const theme = await useItestTheme(wp);
  fs.cpSync(path.join(FIX, name), path.join(theme, 'proto-blocks', name), { recursive: true });
  return theme;
}

itest('gates pass a good block and stop at render for a warning-emitting block', async () => {
  const wp = testWp();
  try {
  await install(wp, 'pb-gate-ok');
  await install(wp, 'pb-gate-bad');
  const ok = runGates(wp, { block: 'pb-gate-ok', attrs: { heading: 'Hello' } });
  assert.equal(ok.ok, true, JSON.stringify(ok, null, 2));
  assert.deepEqual(ok.steps.map((s) => s.id), ['anchor-support', 'validate', 'cache', 'tailwind', 'render']);

  const bad = runGates(wp, { block: 'pb-gate-bad' });
  assert.equal(bad.ok, false);
  const render = bad.steps.find((s) => s.id === 'render');
  assert.equal(render.ok, false);
  assert.match(JSON.stringify(render.detail), /Undefined array key/);
  } finally { restoreTheme(wp); }
});

itest('gates fail fast when the block lacks anchor support', async () => {
  const wp = testWp();
  try {
  const theme = await install(wp, 'pb-gate-ok');
  const dir = path.join(theme, 'proto-blocks', 'pb-gate-noanchor');
  fs.cpSync(path.join(FIX, 'pb-gate-ok'), dir, { recursive: true });
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'block.json'), 'utf8'));
  json.name = 'proto-blocks/pb-gate-noanchor';
  json.supports = { html: false };
  fs.writeFileSync(path.join(dir, 'block.json'), JSON.stringify(json));
  const r = runGates(wp, { block: 'pb-gate-noanchor' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.steps.map((s) => s.id), ['anchor-support']);
  fs.rmSync(dir, { recursive: true, force: true });
  } finally { restoreTheme(wp); }
});

// Copies pb-gate-ok under a new slug with a replacement template.php (inside the pb-itest theme only).
async function installVariant(wp, slug, template) {
  const theme = await install(wp, 'pb-gate-ok');
  const dir = path.join(theme, 'proto-blocks', slug);
  fs.cpSync(path.join(FIX, 'pb-gate-ok'), dir, { recursive: true });
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'block.json'), 'utf8'));
  json.name = `proto-blocks/${slug}`;
  fs.writeFileSync(path.join(dir, 'block.json'), JSON.stringify(json));
  fs.writeFileSync(path.join(dir, 'template.php'), template);
  return dir;
}

// The plugin injects the id into any element root, so only a comment-only template (non-empty
// output, no element) ends up without #pb-gate.
itest('render fails when the output has content but no anchor id', async () => {
  const wp = testWp();
  let dir;
  try {
    dir = await installVariant(wp, 'pb-gate-noid', '<!-- c -->');
    const r = runGates(wp, { block: 'pb-gate-noid' });
    assert.equal(r.ok, false);
    const render = r.steps.at(-1);
    assert.equal(render.id, 'render');
    assert.ok(render.detail.frontend.length > 0, JSON.stringify(render.detail));
    assert.equal(render.detail.frontend.hasAnchor, false);
    assert.equal(render.detail.editor.status, 200);
    assert.equal(render.detail.errors.length, 0);
  } finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); restoreTheme(wp); }
});

itest('render fails when only the editor preview fails', async () => {
  const wp = testWp();
  let dir;
  try {
    dir = await installVariant(wp, 'pb-gate-editor', "<?php if (!isset($block)) { throw new RuntimeException('editor-only boom'); } ?>\n<section <?php echo get_block_wrapper_attributes(); ?>>x</section>\n");
    const r = runGates(wp, { block: 'pb-gate-editor' });
    assert.equal(r.ok, false);
    const render = r.steps.at(-1);
    assert.equal(render.id, 'render');
    assert.equal(render.detail.frontend.hasAnchor, true);
    assert.equal(render.detail.editor.status, 500);
    assert.match(render.detail.editor.message, /editor-only boom/);
  } finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); restoreTheme(wp); }
});

itest('warnings from outside the block folder go to other and do not fail render', async () => {
  const wp = testWp();
  let dir;
  try {
    dir = await installVariant(wp, 'pb-gate-foreign', "<?php add_filter('doing_it_wrong_trigger_error', '__return_true'); _doing_it_wrong('pb-gate', 'foreign notice', '1.0'); ?>\n<section <?php echo get_block_wrapper_attributes(); ?>>x</section>\n");
    const r = runGates(wp, { block: 'pb-gate-foreign' });
    const render = r.steps.at(-1);
    assert.equal(render.id, 'render');
    assert.equal(render.detail.errors.length, 0, JSON.stringify(render.detail));
    assert.ok(render.detail.other.some((o) => /foreign notice/.test(o.message)), JSON.stringify(render.detail));
    assert.equal(r.ok, true);
  } finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); restoreTheme(wp); }
});

itest('a parse error in a template fails the gates without throwing', async () => {
  const wp = testWp();
  let dir;
  try {
    dir = await installVariant(wp, 'pb-gate-parse', '<?php echo ;\n');
    let r;
    assert.doesNotThrow(() => { r = runGates(wp, { block: 'pb-gate-parse' }); });
    assert.equal(r.ok, false);
    assert.equal(r.steps.at(-1).ok, false);
  } finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); restoreTheme(wp); }
});

// ParseError is catchable in PHP; memory exhaustion is a true E_ERROR fatal that kills the wp process.
itest('an uncatchable fatal in a template fails the render step with fatal detail', async () => {
  const wp = testWp();
  let dir;
  try {
    dir = await installVariant(wp, 'pb-gate-fatal', "<?php ini_set('memory_limit', '48M'); $a = str_repeat('x', 200000000); echo strlen($a); ?>\n");
    let r;
    assert.doesNotThrow(() => { r = runGates(wp, { block: 'pb-gate-fatal' }); });
    assert.equal(r.ok, false);
    const last = r.steps.at(-1);
    assert.equal(last.id, 'render', JSON.stringify(r));
    assert.equal(last.ok, false);
    assert.ok(last.detail.fatal && /critical error|memory|fatal/i.test(last.detail.fatal), JSON.stringify(last.detail));
  } finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); restoreTheme(wp); }
});

itest('warnings from a symlinked block folder are attributed to the block', async () => {
  const wp = testWp();
  let link, real;
  try {
    const theme = await install(wp, 'pb-gate-ok');
    real = path.join(theme, 'pb-gate-link-real');
    fs.cpSync(path.join(FIX, 'pb-gate-bad'), real, { recursive: true });
    const bj = path.join(real, 'block.json');
    const json = JSON.parse(fs.readFileSync(bj, 'utf8'));
    json.name = 'proto-blocks/pb-gate-link';
    fs.writeFileSync(bj, JSON.stringify(json));
    link = path.join(theme, 'proto-blocks', 'pb-gate-link');
    fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync(real, link, 'dir');
    wp.check(['proto-blocks', 'cache', 'clear']);
    const r = runGates(wp, { block: 'pb-gate-link' });
    const render = r.steps.find((s) => s.id === 'render');
    assert.ok(render, `plugin discovery/validate did not reach render: ${JSON.stringify(r)}`);
    assert.equal(r.ok, false);
    assert.ok(render.detail.errors.some((e) => /Undefined array key/.test(e.message)), JSON.stringify(render.detail));
    assert.equal(render.detail.other.length, 0, JSON.stringify(render.detail));
  } finally {
    if (link) fs.unlinkSync(link);
    if (real) fs.rmSync(real, { recursive: true, force: true });
    restoreTheme(wp);
  }
});
