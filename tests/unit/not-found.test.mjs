import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { notFoundTemplate, contentBlock, writeNotFound, recordNotFound, probeUrl, PROBE_PATH, TEMPLATE_FILE } from '../../skills/protoblocks-site-builder/scripts/lib/not-found.mjs';
import { PROBE_PATH as A11Y_PROBE_PATH } from '../../skills/protoblocks-site-builder/scripts/qa/site-a11y.mjs';
import { initState, loadState, updateState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';
import { nextAction } from '../../skills/protoblocks-site-builder/scripts/lib/status.mjs';

const SCRIPT = new URL('../../skills/protoblocks-site-builder/scripts/lib/not-found.mjs', import.meta.url).pathname;
const CONTENT = '<!-- wp:proto-blocks/not-found {"heading":"Wrong turn"} /-->';

function fork(site = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-404-'));
  initState(dir, { url: 'http://a.local', path: '/x', ...site });
  return dir;
}
const contentFile = (dir, markup = CONTENT) => { const f = path.join(dir, 'content.html'); fs.writeFileSync(f, markup); return f; };
const check = (dir, over = {}) => {
  const f = path.join(dir, 'check.json');
  fs.writeFileSync(f, JSON.stringify({ url: 'http://a.local/__pb-404-probe__', pass: true, at: '2999-01-01T00:00:00.000Z', viewports: [{ name: 'desktop', pass: true }], screenshots: ['/x/desktop.png'], ...over }));
  return f;
};
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('the probe path is the one site-a11y.mjs probes', () => assert.equal(PROBE_PATH, A11Y_PROBE_PATH));

test('notFoundTemplate wraps the content in header part, Taxi wrapper, <main> and footer part', () => {
  const t = notFoundTemplate(`${CONTENT}\n`);
  assert.ok(t.startsWith('<!-- wp:template-part {"slug":"header","tagName":"header"} /-->'));
  assert.ok(t.trimEnd().endsWith('<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->'));
  assert.match(t, /<div data-taxi>\n\t<div data-taxi-view>\n\t\t<!-- wp:group \{"tagName":"main","align":"full","style":\{"spacing":\{"blockGap":"0"\}\},"layout":\{"type":"default"\}\} -->\n\t\t<main class="wp-block-group alignfull">\n\t\t\t<!-- wp:proto-blocks\/not-found/);
  assert.match(t, /\n\t\t<\/main>\n\t\t<!-- \/wp:group -->\n\t<\/div>\n<\/div>\n/);
  assert.equal(contentBlock(CONTENT), 'not-found');
  assert.equal(contentBlock('<!-- wp:group --><!-- /wp:group -->'), 'group');
  assert.equal(contentBlock('<p>x</p>'), null);
});

test('notFoundTemplate refuses non-block markup, template parts, the Taxi wrapper and a <main> of its own', () => {
  assert.equal(codeOf(() => notFoundTemplate('<p>Not found</p>')), 'EINPUT');
  assert.equal(codeOf(() => notFoundTemplate('')), 'EINPUT');
  assert.equal(codeOf(() => notFoundTemplate(`<!-- wp:template-part {"slug":"header"} /-->${CONTENT}`)), 'EINPUT');
  assert.equal(codeOf(() => notFoundTemplate(`<div data-taxi><div data-taxi-view>${CONTENT}</div></div>`)), 'EINPUT');
  assert.equal(codeOf(() => notFoundTemplate(`<main>${CONTENT}</main>`)), 'EINPUT');
});

test('writeNotFound writes templates/404.html and records site.notFound; a rewrite drops an earlier check', () => {
  const dir = fork();
  const r = writeNotFound(dir, contentFile(dir));
  assert.equal(r.file, path.join(dir, TEMPLATE_FILE));
  assert.equal(r.block, 'not-found');
  assert.equal(fs.readFileSync(r.file, 'utf8'), notFoundTemplate(CONTENT));
  const nf = loadState(dir).site.notFound;
  assert.equal(nf.template, TEMPLATE_FILE);
  assert.equal(nf.block, 'not-found');
  assert.match(nf.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(nf.writtenAt, r.writtenAt);
  // Same content again: fine (idempotent).
  writeNotFound(dir, contentFile(dir));
  updateState(dir, (s) => { s.site.notFound.check = { pass: true, file: 'x', at: 'x', approvedBy: 'developer' }; });
  writeNotFound(dir, contentFile(dir, '<!-- wp:proto-blocks/not-found {"heading":"Off road"} /-->'));
  assert.equal(loadState(dir).site.notFound.check, undefined);
});

test('writeNotFound refuses a 404 template it did not write (EEDITED) unless --force', () => {
  const dir = fork();
  fs.mkdirSync(path.join(dir, 'templates'));
  fs.writeFileSync(path.join(dir, TEMPLATE_FILE), '<!-- a hand-made template -->');
  assert.equal(codeOf(() => writeNotFound(dir, contentFile(dir))), 'EEDITED');
  assert.equal(fs.readFileSync(path.join(dir, TEMPLATE_FILE), 'utf8'), '<!-- a hand-made template -->');
  writeNotFound(dir, contentFile(dir), { force: true });
  // Edited after the tool wrote it: refused again.
  fs.appendFileSync(path.join(dir, TEMPLATE_FILE), '\n<!-- edited -->');
  assert.equal(codeOf(() => writeNotFound(dir, contentFile(dir))), 'EEDITED');
  assert.equal(codeOf(() => writeNotFound(dir, path.join(dir, 'missing.html'))), 'EINPUT');
});

test('probeUrl places the probe under site.url', () => {
  assert.equal(probeUrl({ site: { url: 'http://a.local/' } }), 'http://a.local/__pb-404-probe__');
  assert.equal(codeOf(() => probeUrl({ site: { url: 'a.local' } })), 'EINPUT');
});

test('recordNotFound stores an approved passing check and refuses everything else', () => {
  const dir = fork();
  assert.equal(codeOf(() => recordNotFound(dir, check(dir), { approved: true })), 'ESTATUS');
  writeNotFound(dir, contentFile(dir));
  assert.equal(codeOf(() => recordNotFound(dir, check(dir, { url: 'http://b.local/__pb-404-probe__' }), { approved: true })), 'EINPUT');
  assert.equal(codeOf(() => recordNotFound(dir, check(dir, { at: '2000-01-01T00:00:00.000Z' }), { approved: true })), 'ESTALE');
  assert.equal(codeOf(() => recordNotFound(dir, check(dir, { pass: false, viewports: [{ name: 'mobile', pass: false, failed: ['status 200 (expected 404)'] }] }), { approved: true })), 'ECHECK');
  assert.equal(codeOf(() => recordNotFound(dir, check(dir))), 'EAPPROVAL');
  assert.equal(codeOf(() => recordNotFound(dir, path.join(dir, 'nope.json'), { approved: true })), 'EINPUT');
  assert.equal(loadState(dir).site.notFound.check, undefined);
  const r = recordNotFound(dir, check(dir), { approved: true });
  assert.deepEqual([r.pass, r.approved, r.template], [true, true, TEMPLATE_FILE]);
  const rec = loadState(dir).site.notFound.check;
  assert.deepEqual([rec.pass, rec.file, rec.approvedBy, typeof rec.at], [true, path.join(dir, 'check.json'), 'developer', 'string']);
});

test('status routes not-found until the check is recorded, then on to seo', () => {
  const dir = fork({ theme: { slug: 'acme', screenshot: { page: 'home', source: 'frame', writtenAt: 'x' } }, tokens: {}, navigation: { menus: { primary: { id: 1 } } }, parts: { header: { writtenAt: 'x' } } });
  updateState(dir, (s) => { s.pages.push({ slug: 'home', status: 'seo', sections: [{ n: 1, anchor: 'pb-s1', status: 'done' }], pageQa: { pass: true }, editorQa: { pass: true } }); });
  assert.equal(nextAction(loadState(dir)).action, 'not-found');
  writeNotFound(dir, contentFile(dir));
  assert.equal(nextAction(loadState(dir)).action, 'not-found');
  recordNotFound(dir, check(dir), { approved: true });
  assert.equal(nextAction(loadState(dir)).action, 'seo');
});

test('CLI: usage exits 64; write and record print JSON; errors print [CODE]', () => {
  const dir = fork();
  for (const args of [[], ['write', dir], ['check'], ['record', dir], ['write', dir, 'x', '--approved'], ['nope', dir]]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 64, args.join(' '));
    assert.match(r.stderr, /^Usage: node not-found\.mjs write/);
  }
  const w = spawnSync(process.execPath, [SCRIPT, 'write', dir, contentFile(dir)], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  assert.equal(JSON.parse(w.stdout).block, 'not-found');
  const bad = spawnSync(process.execPath, [SCRIPT, 'record', dir, check(dir)], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^\[EAPPROVAL\]/);
  const ok = spawnSync(process.execPath, [SCRIPT, 'record', dir, check(dir), '--approved'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).approved, true);
});
