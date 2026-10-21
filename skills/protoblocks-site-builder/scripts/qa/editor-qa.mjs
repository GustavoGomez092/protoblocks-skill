#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, stateDir } from '../lib/state.mjs';
import { createWp, loadThemeRuntime } from '../lib/wp.mjs';
import { readBlockJson } from '../lib/library.mjs';
import { PART_ANCHORS } from '../lib/plan.mjs';
import { pageQaPassed } from '../lib/status.mjs';
import { parseBlockName } from '../lib/slugs.mjs';

// Editor QA: the page (or a template part) is opened in wp-admin's block editor as a dedicated administrator and every
// Proto-Blocks block is checked there, not only on the front end: the block list matches the sections, each block is
// valid and its editor preview rendered without an error notice, every field block.json declares is bound in the
// preview markup the editor works from, the inspector shows the block, and opening the post leaves it clean.

/** The administrator editor QA logs in as. Created on first use; remove with `wp user delete pb-editor-qa --yes`. */
export const QA_USER = 'pb-editor-qa';
export const QA_USER_EMAIL = 'pb-editor-qa@example.invalid';
const PROTO_NS = 'proto-blocks';
const INNER = new Set(['inner-blocks', 'innerblocks']);
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const VIEWPORT = { width: 1440, height: 900 };
export const EDITOR_LOAD_TIMEOUT_MS = 60000;
const PREVIEW_WAIT_MS = 30000;
const INSPECTOR_WAIT_MS = 10000;
// Core's error notices for a block whose markup or edit component failed.
const BLOCK_ERROR_TEXT = /This block has encountered an error|Block contains unexpected or invalid content|This block contains unexpected or invalid content/;

const fail = (code, message) => Object.assign(new Error(message), { code });
const inputError = (m) => fail('EINPUT', m);
const pageError = (m) => fail('ENOPAGE', m);
const statusError = (m) => fail('ESTATUS', m);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byN = (a, b) => a.n - b.n;
const normUrl = (u) => String(u ?? '').trim().replace(/\/+$/, '');

// ---- pure: fields ----

/**
 * The fields block.json declares, as the editor must bind them: every `protoBlocks.fields` entry, plus a repeater's
 * `fields` as `<repeater>.<sub>`. A repeater's `itemControls` are edited in the sidebar and never on the canvas, so
 * they are not listed.
 */
export function declaredFields(json) {
  const fields = isObj(json?.protoBlocks?.fields) ? json.protoBlocks.fields : {};
  const out = [];
  for (const [name, f] of Object.entries(fields)) {
    const type = String(f?.type ?? 'text');
    out.push({ name, type });
    if (type !== 'repeater') continue;
    for (const [sub, sf] of Object.entries(isObj(f?.fields) ? f.fields : {})) out.push({ name: `${name}.${sub}`, type: String(sf?.type ?? 'text'), repeater: name, sub });
  }
  return out;
}

/**
 * Counts the bindings in preview markup (the HTML the editor parses, `$is_preview` true). Runs in a browser against a
 * DOM root (it is serialized into page.evaluate), so it uses DOM APIs only: `fields` counts every `data-proto-field`
 * (repeater items included, like the authoring check), `repeaters.<name>` the items and the fields inside them, and
 * `linkItems` the items that are, or contain, an `<a>` (the editor edits such a link from the item toolbar).
 */
export function collectBindings(root) {
  const count = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const fields = {};
  root.querySelectorAll('[data-proto-field]').forEach((e) => count(fields, e.getAttribute('data-proto-field')));
  const repeaters = {};
  root.querySelectorAll('[data-proto-repeater]').forEach((r) => {
    const name = r.getAttribute('data-proto-repeater');
    const items = Array.from(r.querySelectorAll('[data-proto-repeater-item]'));
    const sub = {};
    let linkItems = 0;
    for (const it of items) {
      it.querySelectorAll('[data-proto-field]').forEach((e) => count(sub, e.getAttribute('data-proto-field')));
      if (it.tagName === 'A' || it.querySelector('a')) linkItems++;
    }
    repeaters[name] = { items: items.length, fields: sub, linkItems };
  });
  return { fields, repeaters, innerBlocks: root.querySelectorAll('[data-proto-inner-blocks]').length };
}

/**
 * Declared fields against the bindings of the preview markup. A field is bound when an element carries its
 * `data-proto-field`; a repeater when its `data-proto-repeater` container exists; a repeater subfield when an item
 * binds it, or, for a `link` subfield, when the item is or contains an `<a>` (whole-card or icon-only link, edited
 * from the item toolbar: listed in `toolbar`); an inner-blocks field when `data-proto-inner-blocks` exists.
 * `hints` explain the usual causes (a repeater that renders no item in the preview).
 */
export function compareFields(json, bindings) {
  const declared = declaredFields(json);
  const b = bindings ?? { fields: {}, repeaters: {}, innerBlocks: 0 };
  const bound = [];
  const missing = [];
  const toolbar = [];
  const hints = [];
  for (const d of declared) {
    let ok = false;
    if (d.repeater) {
      const r = b.repeaters?.[d.repeater];
      if ((r?.fields?.[d.sub] ?? 0) > 0) ok = true;
      else if (d.type === 'link' && (r?.linkItems ?? 0) > 0) { ok = true; toolbar.push(d.name); }
      else if (r && r.items === 0) hints.push(`repeater "${d.repeater}" renders no item in the editor preview, so its subfields cannot be bound: seed a placeholder item under $is_preview`);
    } else if (d.type === 'repeater') {
      ok = !!b.repeaters?.[d.name];
    } else if (INNER.has(d.type)) {
      ok = (b.innerBlocks ?? 0) > 0;
    } else {
      ok = (b.fields?.[d.name] ?? 0) > 0;
    }
    (ok ? bound : missing).push(d.name);
  }
  return { declared: declared.map((d) => d.name), bound, missing, toolbar, hints: [...new Set(hints)] };
}

// ---- pure: sections ----

/** The anchors the editor must show as top-level blocks, in `n` order: sections not rendered by a part and not skipped. */
export const expectedAnchors = (sections = []) => [...sections].filter((s) => s.inPart !== true && s.status !== 'skipped').sort(byN).map((s) => s.anchor);

/**
 * Expected anchors against the editor's top-level block list (`{name, anchor}` in editor order): every expected anchor
 * present once, in order, and nothing else at the top level.
 */
export function compareSections(expected, blocks) {
  const found = blocks.map((x) => x.anchor ?? null);
  const counts = {};
  for (const a of found) if (a) counts[a] = (counts[a] ?? 0) + 1;
  const missing = expected.filter((a) => !counts[a]);
  const duplicates = expected.filter((a) => counts[a] > 1);
  const extra = blocks.filter((x) => !x.anchor || !expected.includes(x.anchor)).map((x) => ({ name: x.name, anchor: x.anchor ?? null }));
  const seq = found.filter((a) => a && expected.includes(a));
  const order = missing.length === 0 && duplicates.length === 0 && seq.join('\n') === expected.join('\n');
  return { expected, found, missing, extra, duplicates, order, pass: order && extra.length === 0 };
}

// ---- pure: pass rule ----

/**
 * The editor loaded, no page error, every section present once and in order with nothing extra, every Proto-Blocks
 * block valid, rendered without an error notice, with every declared field bound and its inspector shown, and the
 * post not dirty (opening it and selecting blocks must not change it: a block with unstable attributes does).
 */
export function editorPass(r) {
  if (!r || r.loaded !== true || (r.pageErrors ?? []).length || r.sections?.pass !== true || r.dirty !== false || !Array.isArray(r.blocks)) return false;
  return r.blocks.every((b) => b.isValid === true && (b.proto !== true || (b.rendered === true && (b.fields?.missing ?? []).length === 0 && b.inspector?.pass === true)));
}

/** `wp_persisted_preferences` for the QA user: no welcome guides in the post editor or the Site Editor. */
export const qaPreferences = (at = new Date().toISOString()) => ({
  'core/edit-post': { welcomeGuide: false, welcomeGuideTemplate: false },
  'core/edit-site': { welcomeGuide: false, welcomeGuideStyles: false, welcomeGuidePage: false, welcomeGuideTemplate: false },
  core: { welcomeGuide: false },
  _modified: at,
});

export const randomPassword = () => crypto.randomBytes(24).toString('base64url');

// A WpError carries its argv (the password among them) in its message; never let it out.
function redact(e, secret) {
  if (e && typeof e === 'object') {
    for (const k of ['message', 'stack']) if (typeof e[k] === 'string' && e[k].includes(secret)) e[k] = e[k].split(secret).join('***');
    if (Array.isArray(e.args)) e.args = e.args.map((a) => (typeof a === 'string' ? a.split(secret).join('***') : a));
    if (e.result && typeof e.result === 'object') for (const k of ['stdout', 'stderr']) if (typeof e.result[k] === 'string') e.result[k] = e.result[k].split(secret).join('***');
  }
  return e;
}

/**
 * Creates or reuses the `pb-editor-qa` administrator through WP-CLI, sets a fresh random password for this run
 * (kept in memory only) and writes its editor preferences (welcome guides off). Returns `{id, created, password}`.
 */
export function ensureQaUser(wp, { password = randomPassword(), now } = {}) {
  try {
    const got = wp.run(['user', 'get', QA_USER, '--field=ID']);
    let id = got.code === 0 && /^\d+$/.test(got.stdout.trim()) ? Number(got.stdout.trim()) : null;
    let created = false;
    if (id === null) {
      const out = wp.check(['user', 'create', QA_USER, QA_USER_EMAIL, '--role=administrator', `--user_pass=${password}`, '--porcelain']);
      id = Number(out.trim().split('\n').filter(Boolean).at(-1));
      created = true;
    }
    if (!Number.isInteger(id) || id <= 0) throw fail('EUSER', `Could not resolve the ${QA_USER} user id from WP-CLI.`);
    wp.check(['user', 'update', String(id), `--user_pass=${password}`, '--role=administrator', '--skip-email']);
    wp.check(['user', 'meta', 'update', String(id), 'wp_persisted_preferences', JSON.stringify(qaPreferences(now)), '--format=json']);
    return { id, created, password };
  } catch (e) {
    throw redact(e, password);
  }
}

/** `wp user delete pb-editor-qa --yes` through the resolved WP-CLI (used by tests that created the user). */
export const deleteQaUser = (wp) => wp.run(['user', 'delete', QA_USER, '--yes']);

// ---- inputs from state ----

const editorUrl = (siteUrl, postId) => `${siteUrl}/wp-admin/post.php?post=${postId}&action=edit`;
const partUrl = (siteUrl, theme, part) => `${siteUrl}/wp-admin/site-editor.php?postType=wp_template_part&postId=${encodeURIComponent(`${theme}//${part}`)}&canvas=edit`;

/** `run <themeDir> <page>`: the page's editor url (from `postId`), the anchors its sections expect, and the artifacts dir. */
export function pageInputs(themeDir, slug) {
  const s = loadState(themeDir);
  const p = s.pages.find((x) => x.slug === slug);
  if (!p) throw pageError(`No page "${slug}" in state.`);
  if (!Number.isInteger(p.postId) || p.postId <= 0) throw pageError(`Page "${slug}" has no postId: build it first (page.mjs build).`);
  const siteUrl = normUrl(s.site.url);
  const expected = expectedAnchors(p.sections);
  const bad = expected.find((a) => typeof a !== 'string' || !SAFE_NAME.test(a));
  if (bad !== undefined) throw inputError(`Section anchor ${JSON.stringify(bad ?? null)} on "${slug}" is not a safe id.`);
  return { kind: 'page', slug, postId: p.postId, siteUrl, url: editorUrl(siteUrl, p.postId), expected, outDir: path.join(stateDir(themeDir), 'artifacts', slug, 'editor-qa') };
}

/** `run <themeDir> --parts`: the Site Editor url of each written part (`site.parts.header` / `.footer`) and its anchor. */
export function partsInputs(themeDir) {
  const s = loadState(themeDir);
  const siteUrl = normUrl(s.site.url);
  const theme = s.site.theme?.slug ?? path.basename(path.resolve(themeDir));
  const parts = Object.keys(PART_ANCHORS).filter((k) => isObj(s.site.parts?.[k]));
  if (!parts.length) throw pageError('No header or footer part is recorded in site.parts yet (parts.mjs write); nothing to check.');
  return { kind: 'parts', siteUrl, parts: parts.map((part) => ({ part, url: partUrl(siteUrl, theme, part), expected: [PART_ANCHORS[part]] })), outDir: path.join(stateDir(themeDir), 'artifacts', 'parts', 'editor-qa') };
}

// ---- the editor ----

/** Logs into wp-admin through wp-login.php. Throws ELOGIN (without the password) when WordPress refuses. */
export async function loginWpAdmin(page, siteUrl, user, password, { timeoutMs = EDITOR_LOAD_TIMEOUT_MS } = {}) {
  await page.goto(`${siteUrl}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.fill('#user_login', user);
  await page.fill('#user_pass', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {}),
    page.click('#wp-submit'),
  ]);
  const error = await page.$('#login_error');
  if (error) throw fail('ELOGIN', `wp-login.php refused the ${user} login: ${(await error.textContent())?.trim().slice(0, 300)}`);
  if (!/\/wp-admin\//.test(page.url())) throw fail('ELOGIN', `wp-login.php did not land in wp-admin (now at ${page.url()}).`);
}

async function canvasFrame(page, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const iframe = page.frames().find((f) => f.name() === 'editor-canvas');
    if (iframe && await iframe.$('[data-block]').catch(() => null)) return { frame: iframe, canvas: 'iframe' };
    if (!iframe && await page.$('.block-editor-block-list__layout [data-block]')) return { frame: page.mainFrame(), canvas: 'document' };
    await page.waitForTimeout(250);
  }
  return { frame: null, canvas: null };
}

const dismissGuides = (page) => page.evaluate(() => {
  try {
    const prefs = window.wp?.data?.dispatch('core/preferences');
    for (const scope of ['core/edit-post', 'core/edit-site', 'core']) for (const key of ['welcomeGuide', 'welcomeGuideTemplate', 'welcomeGuideStyles', 'welcomeGuidePage']) prefs?.set(scope, key, false);
  } catch { /* preferences store missing */ }
}).catch(() => {});

async function openInspector(page, waitMs = INSPECTOR_WAIT_MS) {
  await page.evaluate(() => {
    const d = window.wp.data.dispatch;
    try { d('core/edit-post')?.openGeneralSidebar?.('edit-post/block'); } catch { /* not the post editor */ }
    try { d('core/edit-site')?.openGeneralSidebar?.('edit-site/block-inspector'); } catch { /* not the site editor */ }
    for (const [scope, area] of [['core', 'edit-post/block'], ['core/edit-post', 'edit-post/block'], ['core', 'edit-site/block-inspector'], ['core/edit-site', 'edit-site/block-inspector']]) {
      try { d('core/interface')?.enableComplementaryArea?.(scope, area); } catch { /* older interface store */ }
    }
  }).catch(() => {});
  await page.waitForSelector('.block-editor-block-inspector', { timeout: waitMs }).catch(() => {});
}

// The block definition editor QA compares against: block.json in the fork, else the plugin's localized data.
function blockDefinition(themeDir, slug, localized) {
  let json = null;
  try { json = themeDir ? readBlockJson(themeDir, slug) : null; } catch { json = null; }
  if (json) return { json, source: 'block.json' };
  const d = (localized ?? []).find((x) => x && (x.name === slug || x.name === `${PROTO_NS}/${slug}`));
  if (!d) return { json: null, source: null };
  const pb = isObj(d.protoBlocks) ? d.protoBlocks : isObj(d.schema?.protoBlocks) ? d.schema.protoBlocks : { fields: d.fields, controls: d.controls };
  return { json: { title: d.title, protoBlocks: { fields: pb.fields ?? {}, controls: pb.controls ?? {} } }, source: 'protoBlocksData' };
}

/**
 * Audits one editor page (the post editor, or the Site Editor on a template part) that `page` is logged in for.
 * `expected`: the anchors of the top-level blocks in order; `defs(slug)`: the block definition for a Proto-Blocks slug.
 * Writes `<outDir>/<prefix>editor.png` and `<prefix>inspector.png`.
 */
export async function auditEditor(page, { url, expected, themeDir, outDir, prefix = '', timeoutMs = EDITOR_LOAD_TIMEOUT_MS, previewWaitMs = PREVIEW_WAIT_MS, inspectorWaitMs = INSPECTOR_WAIT_MS }) {
  fs.mkdirSync(outDir, { recursive: true });
  const result = { url, pass: false, loaded: false, canvas: null, blocks: [], sections: null, dirty: null, pageErrors: [], consoleErrors: [], screenshots: {} };
  const onConsole = (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); };
  const onError = (e) => result.pageErrors.push(String(e?.message ?? e));
  page.on('console', onConsole);
  page.on('pageerror', onError);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (/wp-login\.php/.test(page.url())) throw fail('ELOGIN', `The editor redirected to wp-login.php: the ${QA_USER} session is not valid.`);
    await dismissGuides(page);
    try {
      await page.waitForFunction(() => { const s = window.wp?.data?.select?.('core/block-editor'); return !!s && s.getBlocks().length > 0; }, null, { timeout: timeoutMs });
    } catch (e) {
      result.error = `The block editor did not load any block within ${timeoutMs} ms (${page.url()}): ${e?.message ?? e}`;
      return finish();
    }
    await dismissGuides(page);
    await page.keyboard.press('Escape').catch(() => {});
    const { frame, canvas } = await canvasFrame(page, timeoutMs);
    result.canvas = canvas;
    if (!frame) { result.error = 'No editor canvas with blocks appeared (neither the editor-canvas iframe nor an inline block list).'; return finish(); }
    result.loaded = true;
    // Proto-Blocks previews load asynchronously; wait until no block shows its spinner.
    await frame.waitForFunction(() => !document.querySelector('.proto-blocks-loading'), null, { timeout: previewWaitMs }).catch(() => {});
    await page.waitForTimeout(300);
    const editorShot = path.join(outDir, `${prefix}editor.png`);
    await page.screenshot({ path: editorShot, fullPage: false });
    result.screenshots.editor = editorShot;

    const list = await page.evaluate(() => window.wp.data.select('core/block-editor').getBlocks().map((b) => ({
      name: b.name, clientId: b.clientId, isValid: b.isValid !== false, anchor: typeof b.attributes?.anchor === 'string' ? b.attributes.anchor : null, attributes: JSON.parse(JSON.stringify(b.attributes ?? {})),
    })));
    result.sections = compareSections(expected, list);
    const localized = await page.evaluate(() => (Array.isArray(window.protoBlocksData?.blocks) ? JSON.parse(JSON.stringify(window.protoBlocksData.blocks)) : null)).catch(() => null);
    let inspectorShot = null;
    for (const b of list) {
      const row = { anchor: b.anchor, name: b.name, clientId: b.clientId, isValid: b.isValid };
      let parsed = null;
      try { parsed = parseBlockName(b.name); } catch { parsed = null; }
      row.proto = parsed?.namespace === PROTO_NS;
      if (!row.proto) { result.blocks.push(row); continue; }
      const { json, source } = blockDefinition(themeDir, parsed.slug, localized);
      row.definition = source;
      // The canvas: the block wrapper, with content and without an error notice.
      const dom = await frame.evaluate((id) => {
        const el = document.querySelector(`[data-block="${id}"]`);
        if (!el) return { found: false };
        const text = el.textContent || '';
        const warn = el.querySelector('.block-editor-warning, .proto-blocks-error');
        return {
          found: true,
          empty: el.children.length === 0 && !text.trim(),
          loading: !!el.querySelector('.proto-blocks-loading'),
          notice: warn ? (warn.textContent || '').trim().slice(0, 300) : null,
          errorText: /This block has encountered an error|Block contains unexpected or invalid content|This block contains unexpected or invalid content/.test(text),
          canvas: { editable: el.querySelectorAll('.block-editor-rich-text__editable, [contenteditable="true"]').length, innerBlocks: el.querySelectorAll('.proto-blocks-inner-blocks, .block-editor-inner-blocks').length, linkFields: el.querySelectorAll('.proto-blocks-link-field-wrapper').length },
        };
      }, b.clientId);
      row.rendered = dom.found === true && !dom.empty && !dom.loading && dom.notice === null && dom.errorText !== true;
      row.canvas = dom.found ? dom.canvas : null;
      if (!row.rendered) row.renderError = !dom.found ? 'no [data-block] wrapper in the canvas' : dom.loading ? 'the preview is still loading' : dom.notice ?? (dom.errorText ? 'core error notice' : 'the wrapper is empty');
      // The preview markup, requested exactly as the editor requests it (admin-ajax, the editor's own nonce), parsed
      // for its data-proto-* bindings.
      const keys = json ? [...Object.keys(isObj(json.protoBlocks?.fields) ? json.protoBlocks.fields : {}), ...Object.keys(isObj(json.protoBlocks?.controls) ? json.protoBlocks.controls : {})] : null;
      const attrs = keys ? Object.fromEntries(keys.filter((k) => k in b.attributes).map((k) => [k, b.attributes[k]])) : Object.fromEntries(Object.entries(b.attributes).filter(([k]) => k !== 'anchor'));
      const preview = await page.evaluate(async ({ slug, attributes, src }) => {
        const d = window.protoBlocksData;
        if (!d?.ajaxUrl || !d?.previewNonce) return { ok: false, error: 'window.protoBlocksData has no ajaxUrl/previewNonce (is Proto-Blocks active?)' };
        try {
          const res = await fetch(d.ajaxUrl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ action: 'proto_blocks_preview', template: slug, attributes: JSON.stringify(attributes), nonce: d.previewNonce }) });
          const j = await res.json().catch(() => null);
          if (!j?.success || typeof j.data?.html !== 'string') return { ok: false, status: res.status, error: typeof j?.data === 'string' ? j.data : j?.data?.message ?? `no html in the preview response (HTTP ${res.status})` };
          const doc = new DOMParser().parseFromString(j.data.html, 'text/html');
          const collect = new Function(`return (${src})`)();
          return { ok: true, status: res.status, bindings: collect(doc.body), bytes: j.data.html.length };
        } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
      }, { slug: parsed.slug, attributes: attrs, src: collectBindings.toString() });
      row.preview = preview.ok ? { status: preview.status, bytes: preview.bytes } : { error: preview.error, status: preview.status ?? null };
      row.fields = json ? compareFields(json, preview.ok ? preview.bindings : null) : { declared: [], bound: [], missing: [], toolbar: [], hints: ['no block.json found for this block in the fork (and no localized definition): fields were not compared'] };
      if (json && !preview.ok) row.fields.hints.push(`the editor preview request failed: ${preview.error}`);
      // The inspector: select the block, open the sidebar, read the block card and its panels.
      await page.evaluate((id) => window.wp.data.dispatch('core/block-editor').selectBlock(id), b.clientId);
      await openInspector(page, inspectorWaitMs);
      await page.waitForTimeout(250);
      const ins = await page.evaluate(() => {
        const root = document.querySelector('.block-editor-block-inspector');
        if (!root) return { present: false };
        return { present: true, title: root.querySelector('.block-editor-block-card__title')?.textContent?.trim() ?? null, panels: root.querySelectorAll('.components-panel__body').length, controls: root.querySelectorAll('.proto-blocks-control').length };
      });
      const declaredControls = json ? Object.keys(isObj(json.protoBlocks?.controls) ? json.protoBlocks.controls : {}).length : 0;
      const titleOk = ins.present && typeof ins.title === 'string' && ins.title.length > 0 && (!json?.title || ins.title === json.title);
      row.inspector = { ...ins, expectedTitle: json?.title ?? null, declaredControls, pass: titleOk && (declaredControls === 0 || ins.panels >= 1) };
      if (!inspectorShot) {
        inspectorShot = path.join(outDir, `${prefix}inspector.png`);
        try { await page.locator('.block-editor-block-inspector').first().screenshot({ path: inspectorShot }); } catch { await page.screenshot({ path: inspectorShot, fullPage: false }); }
        result.screenshots.inspector = inspectorShot;
      }
      result.blocks.push(row);
    }
    result.dirty = await page.evaluate(() => {
      const ed = window.wp.data.select('core/editor');
      if (ed && typeof ed.isEditedPostDirty === 'function') return ed.isEditedPostDirty() === true;
      const core = window.wp.data.select('core');
      return (core?.__experimentalGetDirtyEntityRecords?.() ?? []).length > 0;
    });
    return finish();
  } catch (e) {
    result.error = String(e?.message ?? e);
    if (e?.code) result.errorCode = e.code;
    return finish();
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onError);
  }
  function finish() { result.pass = editorPass(result); return result; }
}

/**
 * `run`: resolves WP-CLI (preflight), the QA user and the editor pages from state, logs in once and audits the page
 * (or the header/footer parts). The result is written to `<outDir>/editor-qa.json` and returned; a failed audit
 * still produces a result (`pass: false` with `error`), so it can be recorded.
 */
export async function runEditorQa(themeDir, { slug, parts = false } = {}) {
  const rt = loadThemeRuntime(themeDir);
  const inputs = parts ? partsInputs(themeDir) : pageInputs(themeDir, slug);
  fs.mkdirSync(inputs.outDir, { recursive: true });
  const file = path.join(inputs.outDir, 'editor-qa.json');
  const wp = createWp(rt);
  const user = ensureQaUser(wp);
  const { launchBrowser } = await import('./browser.mjs');
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
  let out;
  try {
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await loginWpAdmin(page, inputs.siteUrl, QA_USER, user.password);
    if (inputs.kind === 'page') {
      const r = await auditEditor(page, { url: inputs.url, expected: inputs.expected, themeDir, outDir: inputs.outDir });
      out = { ...r, postId: inputs.postId, user: { login: QA_USER, id: user.id, created: user.created } };
    } else {
      const partResults = {};
      for (const p of inputs.parts) partResults[p.part] = await auditEditor(page, { url: p.url, expected: p.expected, themeDir, outDir: inputs.outDir, prefix: `${p.part}-` });
      out = { pass: Object.values(partResults).every((r) => r.pass === true), parts: partResults, user: { login: QA_USER, id: user.id, created: user.created } };
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  out.file = file;
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

// ---- record ----

function readResult(file) {
  const abs = path.resolve(file);
  let r;
  try { r = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { throw inputError(`Cannot read editor-qa result ${abs}: ${e.message}`); }
  if (!isObj(r)) throw inputError(`Editor-qa result ${abs} is not a JSON object.`);
  return { abs, r };
}

/**
 * Records an editor-QA result for a page in status `building` whose sections are all done or skipped. The result must
 * be of the page's post. Writes `pageQa`'s sibling `editorQa: {pass, file, at}`; a pass sets the page `seo` once page
 * QA has passed (or its differences were accepted), so a page needs both checks before SEO.
 */
export function recordEditorQa(themeDir, slug, file) {
  const { abs, r } = readResult(file);
  const pass = r.pass === true;
  let status;
  updateState(themeDir, (s) => {
    const p = s.pages.find((x) => x.slug === slug);
    if (!p) throw pageError(`No page "${slug}" in state.`);
    if (p.status !== 'building') throw statusError(`Page "${slug}" is "${p.status}", not "building": editor QA is recorded once, after its sections are done.`);
    const open = p.sections.filter((x) => x.status !== 'done' && x.status !== 'skipped');
    if (open.length) throw statusError(`Page "${slug}" has sections that are not done or skipped (${open.map((x) => `${x.n}: ${x.status}`).join(', ')}); finish them, then re-run editor QA.`);
    if (!Number.isInteger(p.postId) || r.postId !== p.postId) throw inputError(`${abs} checked post ${JSON.stringify(r.postId ?? null)}, but page "${slug}" is post ${JSON.stringify(p.postId ?? null)}; re-run editor-qa.mjs run for this page.`);
    p.editorQa = { pass, file: abs, at: new Date().toISOString() };
    if (pass && pageQaPassed(p)) p.status = 'seo';
    status = p.status;
  });
  return { pass, status };
}

/** Records a `--parts` result as `site.parts.editorQa = {pass, file, at}`. */
export function recordPartsEditorQa(themeDir, file) {
  const { abs, r } = readResult(file);
  if (!isObj(r.parts)) throw inputError(`${abs} is not a --parts result (no "parts" object); re-run editor-qa.mjs run "$THEME" --parts.`);
  const pass = r.pass === true;
  updateState(themeDir, (s) => {
    s.site.parts = { ...(s.site.parts ?? {}), editorQa: { pass, file: abs, at: new Date().toISOString() } };
  });
  return { pass, parts: Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, v?.pass === true])) };
}

const USAGE = 'Usage: node editor-qa.mjs run <themeDir> <page> | run <themeDir> --parts | record <themeDir> <page> <editor-qa.json> | record <themeDir> --parts <editor-qa.json>\n';

async function main(argv) {
  const [cmd, themeDir, a, b] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'run' && themeDir && a && argv.length === 3) {
    if (a.startsWith('--') && a !== '--parts') { process.stderr.write(USAGE); process.exit(64); }
    const r = a === '--parts' ? await runEditorQa(themeDir, { parts: true }) : await runEditorQa(themeDir, { slug: a });
    out(r);
    if (!r.pass) process.exit(1);
    return;
  }
  if (cmd === 'record' && themeDir && a && b && argv.length === 4 && !b.startsWith('--')) {
    if (a === '--parts') return out(recordPartsEditorQa(themeDir, b));
    if (!a.startsWith('--')) return out(recordEditorQa(themeDir, a, b));
  }
  process.stderr.write(USAGE);
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
