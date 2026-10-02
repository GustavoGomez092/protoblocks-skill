#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { loadState, updateState } from './state.mjs';
import { importMedia } from './media.mjs';
import { normalizeJsonld, jsonldSupported } from './jsonld.mjs';

export const SCHEMA_PAGE_TYPES = ['WebPage', 'ItemPage', 'AboutPage', 'FAQPage', 'QAPage', 'ProfilePage', 'ContactPage', 'MedicalWebPage', 'CollectionPage', 'CheckoutPage', 'RealEstateListing', 'SearchResultsPage'];

const fail = (code, message) => Object.assign(new Error(message), { code });
const isHttps = (u) => {
  if (typeof u !== 'string') return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
};

// Renders Yoast vars for length checks. Without context the site name is empty and the separator is "-".
export const renderTitle = (t, { siteName = '', sep = '-' } = {}) => String(t).replace(/%%sep%%/g, () => sep).replace(/%%sitename%%/g, () => siteName);
// Social titles carry no site name: drop the vars, then any separator left dangling at either end.
export const socialTitle = (t) => String(t).replace(/%%(sep|sitename)%%/g, '').replace(/^[\s\-–—|·•:]+|[\s\-–—|·•:]+$/g, '');
const val = (leaf) => leaf?.value;

/** ctx = { siteName, sep } (from `yoast.php site`) makes the title check use the real rendered title. */
export function validateSeo(seo, ctx) {
  if (!seo || typeof seo !== 'object' || Array.isArray(seo)) return ['seo: must be an object of {value, inferred} leaves'];
  const errors = [];
  for (const [k, leaf] of Object.entries(seo)) {
    if (!leaf || typeof leaf !== 'object' || !('value' in leaf) || typeof leaf.inferred !== 'boolean') errors.push(`${k}: needs {value, inferred}`);
    else if (leaf.inferred && !leaf.why) errors.push(`${k}: inferred values need a "why"`);
  }
  const kw = val(seo.focusKeyword);
  if (typeof kw !== 'string' || kw !== kw.toLowerCase() || kw.trim().split(/\s+/).length > 4 || !kw.trim()) errors.push('focusKeyword: 1–4 lowercase words');
  else if (/[%<>]/.test(kw)) errors.push('focusKeyword: must not contain %, < or >');
  const title = val(seo.title);
  if (typeof title !== 'string' || !title.trim()) errors.push('title: required');
  else if (ctx) {
    const rendered = renderTitle(title, ctx).trim();
    if (rendered.length > 60) errors.push(`title: renders to ${rendered.length} chars (max 60) with site name "${ctx.siteName}": ${rendered}`);
  } else if (renderTitle(title).length > 60) errors.push(`title: renders to ${renderTitle(title).length} chars (max 60 before the site name)`);
  const d = val(seo.description);
  if (typeof d !== 'string' || d.length < 120 || d.length > 156) errors.push(`description: ${typeof d === 'string' ? d.length : 0} chars (need 120–156)`);
  else if (/[\r\n]/.test(d)) errors.push('description: must not contain newlines');
  if (seo.schemaPageType && !SCHEMA_PAGE_TYPES.includes(val(seo.schemaPageType))) errors.push(`schemaPageType: must be one of ${SCHEMA_PAGE_TYPES.join(', ')}`);
  if (seo.schema) {
    try { normalizeJsonld(val(seo.schema)); } catch (e) { errors.push(`schema: ${e.message}`); }
  }
  if (seo.organization) {
    const org = val(seo.organization);
    if (!org || typeof org !== 'object' || typeof org.name !== 'string' || !org.name.trim()) errors.push('organization: needs a non-empty name');
    else {
      if (org.socials !== undefined && (!Array.isArray(org.socials) || !org.socials.every(isHttps))) errors.push('organization: socials must be an array of https URLs');
    }
  }
  return errors;
}

export function buildYoastSpec({ postId, seo, ogImageId = null, organizationLogoId = null, forceOrganization = false }) {
  const title = val(seo.title);
  const desc = val(seo.description);
  const org = val(seo.organization);
  return {
    postId,
    meta: {
      focuskw: val(seo.focusKeyword),
      title,
      metadesc: desc,
      'opengraph-title': socialTitle(title),
      'opengraph-description': desc,
      'opengraph-image-id': ogImageId,
      'twitter-title': socialTitle(title),
      'twitter-description': desc,
      'twitter-image-id': ogImageId,
      // Absent leaf: leave the page type alone (Yoast falls back to its post-type default).
      ...(seo.schemaPageType ? { schema_page_type: val(seo.schemaPageType) } : {}),
    },
    jsonld: val(seo.schema) ? normalizeJsonld(val(seo.schema)) : null,
    featuredImageId: ogImageId,
    organization: org?.name ? { name: org.name, logoId: organizationLogoId, socials: org.socials ?? [] } : null,
    forceOrganization,
  };
}

function requireFile(file, what) {
  let ok = false;
  try { ok = typeof file === 'string' && fs.statSync(path.resolve(file)).isFile(); } catch { /* handled below */ }
  if (!ok) throw fail('EFILE', `${what}: cannot read ${file}`);
}

const YOAST_PHP = path.join(WP_SCRIPTS_DIR, 'yoast.php');
const OG_IMAGE_CLI = path.join(WP_SCRIPTS_DIR, '..', 'qa', 'og-image.mjs');
const OG = { width: 1200, height: 630 };

function yoastError(wp, args) {
  const out = wp.evalFile(YOAST_PHP, args);
  if (out?.error) throw fail(out.error.code ?? 'EYOAST', out.error.message ?? 'Yoast writer failed');
  return out;
}

/** The Yoast values the skill writes, as `yoast.php get` reads them back (raw post meta; '' when unset). */
export const LIVE_KEYS = ['focuskw', 'title', 'metadesc', 'opengraph-title', 'opengraph-description', 'opengraph-image-id', 'twitter-title', 'twitter-description', 'twitter-image-id', 'schema_page_type', 'jsonld'];
const pickLive = (o) => Object.fromEntries(LIVE_KEYS.map((k) => [k, o?.[k] == null ? '' : String(o[k])]));
const parseJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
// JSON-LD is compared as data (PHP pretty-prints it); everything else as trimmed text (Yoast trims on save).
function sameValue(field, a, b) {
  if (a == null || b == null) return a == b; // eslint-disable-line eqeqeq
  if (field === 'jsonld') {
    if (String(a).trim() === '' || String(b).trim() === '') return String(a).trim() === String(b).trim();
    const x = parseJson(a); const y = parseJson(b);
    return x !== undefined && y !== undefined ? JSON.stringify(x) === JSON.stringify(y) : String(a).trim() === String(b).trim();
  }
  return String(a).trim() === String(b).trim();
}

// What a page applied before appliedValues were stored would have written (its seo leaves through buildYoastSpec).
function legacyApplied(pageSeo) {
  let spec;
  try { spec = buildYoastSpec({ postId: 0, seo: pageSeo, ogImageId: pageSeo.ogImageId ?? null }); } catch { return {}; }
  const out = {};
  const has = { title: !!val(pageSeo.title), 'opengraph-title': !!val(pageSeo.title), 'twitter-title': !!val(pageSeo.title) };
  for (const [k, v] of Object.entries(spec.meta)) if (v !== null && v !== undefined && v !== '' && has[k] !== false) out[k] = String(v);
  if (spec.jsonld?.length) out.jsonld = JSON.stringify(spec.jsonld);
  return out;
}
const appliedOf = (page) => (page.seo ? (page.seo.appliedValues ?? legacyApplied(page.seo)) : {});

function findPage(themeDir, slug) {
  const page = loadState(themeDir).pages.find((p) => p.slug === slug);
  if (!page) throw fail('ENOPAGE', `No page "${slug}" in state.`);
  if (!Number.isInteger(page.postId) || page.postId <= 0) throw fail('ENOPAGE', `Page "${slug}" has no postId; build it first.`);
  return page;
}

// Live values that differ from what the skill last applied (or, on a first apply, any non-empty live value).
function editedFields(live, applied, fields = LIVE_KEYS, next = {}) {
  return fields
    .filter((f) => String(live[f] ?? '').trim() !== '' && !sameValue(f, live[f], applied[f] ?? '') && !(f in next && next[f] !== undefined && sameValue(f, live[f], next[f])))
    .map((f) => ({ field: f, live: live[f], applied: applied[f] ?? null }));
}

/** `seo.mjs get`: the page's live Yoast values (as wp-admin left them), the values the skill last applied, and the difference. */
export function seoGet(wp, themeDir, slug) {
  const page = findPage(themeDir, slug);
  const values = pickLive(yoastError(wp, ['get', String(page.postId)]));
  const applied = page.seo ? appliedOf(page) : null;
  return { slug, postId: page.postId, values, appliedValues: applied, edited: editedFields(values, applied ?? {}) };
}

/** Width and height from a PNG header; null when the file is not a PNG. */
export function pngSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(24);
    if (fs.readSync(fd, b, 0, 24, 0) < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// A supplied OG image that is not 1200x630 is cover-fitted (top-aligned, like generated ones) by og-image.mjs --fit.
function fitSuppliedOgImage(file, themeDir, slug) {
  const size = pngSize(file);
  if (size && size.width === OG.width && size.height === OG.height) return { file, resized: false, source: size };
  const out = path.join(themeDir, '.protoblocks', 'artifacts', slug, 'og-supplied.png');
  const r = spawnSync(process.execPath, [OG_IMAGE_CLI, '--fit', path.resolve(file), '--out', out], { encoding: 'utf8', timeout: 120000 });
  let res;
  try { res = r.status === 0 ? JSON.parse(r.stdout) : null; } catch { res = null; }
  if (!res) {
    throw fail('EOGIMAGE', `Cannot check or resize the supplied OG image ${file} to ${OG.width}x${OG.height}: ${(r.stderr || r.error?.message || r.stdout || '').trim().split('\n')[0].slice(0, 300)}. Install the QA tools (npm install in scripts/qa) or supply a ${OG.width}x${OG.height} image.`);
  }
  return res.resized ? { file: res.out, resized: true, source: res.source } : { file, resized: false, source: res.source };
}

/**
 * Applies seo.json to the page through Yoast. Refuses (EEDITED) when a live Yoast value it would overwrite was edited
 * outside the skill since its last apply (or exists before its first apply), unless force.
 */
export function applySeo(wp, themeDir, slug, seo, { forceOrganization = false, force = false, index = true } = {}) {
  const errors = validateSeo(seo);
  if (errors.length) throw fail('ESEO', `Invalid SEO:\n- ${errors.join('\n- ')}`);
  const page = findPage(themeDir, slug);
  // Validate every input before the first import so a bad path cannot leave a half-applied run.
  const ogFile = val(seo.ogImage)?.file;
  if (ogFile !== undefined) requireFile(ogFile, 'ogImage.file');
  const org = val(seo.organization);
  if (org?.logo?.file !== undefined) requireFile(org.logo.file, 'organization.logo.file');
  // The rendered <title> must be <= 60, so check it with this site's real name and separator before any import.
  const warnings = [];
  let ctx;
  let siteOrg;
  try {
    const site = yoastError(wp, ['site']);
    ctx = { siteName: String(site.siteName ?? ''), sep: String(site.sep ?? '-') };
    siteOrg = site.organization;
  } catch (e) {
    // The lookup is an extra check; losing it must not block the SEO. The context-free title check already passed.
    warnings.push(`site context unavailable: ${String(e.message).split('\n')[0].slice(0, 300)}`);
  }
  const siteErrors = ctx ? validateSeo(seo, ctx) : [];
  if (siteErrors.length) throw fail('ESEO', `Invalid SEO:\n- ${siteErrors.join('\n- ')}`);

  // What this run will write, before any import: the meta (image ids are known only after import) and the JSON-LD.
  const spec = buildYoastSpec({ postId: page.postId, seo, ogImageId: val(seo.ogImage)?.id ?? (ogFile ? -1 : null), forceOrganization });
  let supported;
  const isSupported = () => (supported ??= jsonldSupported(wp));
  let jsonld = 'none';
  if (!seo.schema) {
    // A schema the skill applied earlier would otherwise linger on the page after it was dropped from the SEO.
    // Only when the theme supports JSON-LD; otherwise the meta is not ours to touch.
    delete spec.jsonld;
    if (page.seo?.schema) {
      if (isSupported()) { spec.jsonld = []; jsonld = 'cleared'; } else jsonld = 'unsupported';
    }
  } else if (!isSupported()) { delete spec.jsonld; jsonld = 'unsupported'; } else jsonld = spec.jsonld.length ? 'written' : 'cleared';

  const next = {};
  for (const [k, v] of Object.entries(spec.meta)) if (v !== null && v !== undefined && v !== '') next[k] = v === -1 ? undefined : String(v);
  if ('jsonld' in spec) next.jsonld = spec.jsonld.length ? JSON.stringify(spec.jsonld) : '';
  const live = pickLive(yoastError(wp, ['get', String(page.postId)]));
  const edited = editedFields(live, appliedOf(page), Object.keys(next), next);
  if (edited.length && !force) {
    const list = edited.map((e) => `- ${e.field}: live ${JSON.stringify(e.live)}; ${e.applied === null ? 'never applied by the skill' : `last applied ${JSON.stringify(e.applied)}`}`).join('\n');
    throw Object.assign(fail('EEDITED', `Yoast values for page "${slug}" were set outside the skill (wp-admin?) and would be overwritten:\n${list}\nRead them with seo.mjs get and treat them as provided (put them in seo.json), or re-run with --force to overwrite them.`), { fields: edited });
  }

  const media = [];
  let ogImageId = val(seo.ogImage)?.id ?? null;
  let ogImage;
  if (ogFile) {
    ogImage = fitSuppliedOgImage(ogFile, themeDir, slug);
    const m = importMedia(wp, ogImage.file, { alt: page.title ?? slug });
    ogImageId = m.id;
    media.push({ role: 'ogImage', id: m.id, reused: m.reused });
  }
  // Yoast keeps a configured Organization unless forced: do not import a logo it will not use.
  const orgKept = siteOrg && !forceOrganization ? !(siteOrg.represents === 'company' && !siteOrg.name) : false;
  let organizationLogoId = org?.logo?.id ?? null;
  if (org?.logo?.file && !orgKept) {
    const m = importMedia(wp, org.logo.file, { alt: `${org.name} logo` });
    organizationLogoId = m.id;
    media.push({ role: 'organizationLogo', id: m.id, reused: m.reused });
  }
  if (orgKept) organizationLogoId = null;
  if (org && !orgKept && !org.logo?.file && !org.logo?.id) {
    warnings.push('organization has no logo: Yoast prints no Organization schema piece without one (it needs a company name and a logo). Add organization.logo or ask the developer for the logo file.');
  }
  for (const k of ['opengraph-image-id', 'twitter-image-id']) if (k in spec.meta) spec.meta[k] = ogImageId;
  spec.featuredImageId = ogImageId;
  if (spec.organization) spec.organization.logoId = organizationLogoId;

  const result = wp.evalFilePayload(YOAST_PHP, 'apply', spec);
  if (result?.error) throw fail(result.error.code ?? 'EYOAST', result.error.message ?? 'Yoast writer failed');
  if (index) {
    const idx = wp.run(['yoast', 'index', '--skip-confirmation']);
    result.index = idx.code === 0 ? 'ok' : `failed: ${(idx.stderr || idx.stdout).trim().slice(0, 300)}`;
  } else result.index = 'skipped';
  result.jsonld = jsonld;
  result.media = media;
  if (ogImage) result.ogImage = ogImage;
  if (edited.length) result.overwritten = edited;
  if (warnings.length) result.warnings = warnings;
  const stored = pickLive(result.stored);
  delete result.stored;
  const written = Object.keys(next);
  updateState(themeDir, (s) => {
    const p = s.pages.find((x) => x.slug === slug);
    if (!p) return;
    const appliedValues = { ...appliedOf(p) };
    for (const k of written) appliedValues[k] = stored[k];
    p.seo = { ...seo, applied: new Date().toISOString(), ogImageId, appliedValues };
    if (p.status === 'done') p.status = 'seo'; // the old audit no longer applies
  });
  return result;
}

const sameUrl = (a, b) => {
  const n = (u) => { try { const x = new URL(String(u)); return `${x.origin}${x.pathname.replace(/\/+$/, '')}${x.search}`; } catch { return null; } };
  return n(a) !== null && n(a) === n(b);
};

/**
 * Records a seo-audit result. The audit must be of this page's URL, with the applied focus keyword, and newer than
 * the last apply (EAUDITSTALE otherwise); only a page in status `seo` is promoted to `done` (ESTATUS otherwise).
 */
export function recordAudit(themeDir, slug, auditFile) {
  const file = path.resolve(auditFile);
  let audit;
  try { audit = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw fail('EINPUT', `Cannot read audit file ${file}: ${e.message}`); }
  if (!audit || typeof audit !== 'object' || Array.isArray(audit) || typeof audit.pass !== 'boolean') throw fail('EINPUT', `${file} is not an audit result (expected an object with a boolean "pass").`);
  let status;
  updateState(themeDir, (s) => {
    const p = s.pages.find((x) => x.slug === slug);
    if (!p) throw fail('ENOPAGE', `No page "${slug}" in state.`);
    if (p.status !== 'seo') {
      throw fail('ESTATUS', `Page "${slug}" is "${p.status}", not "seo": ${p.status === 'done' ? 'it already has a recorded audit; re-apply its SEO (seo.mjs apply) to audit it again' : 'it is not ready for an SEO audit until every section is done or skipped and its SEO is applied'}.`);
    }
    const applied = p.seo?.applied;
    const kw = p.seo?.focusKeyword?.value;
    if (!applied || !kw) throw fail('EAUDITSTALE', `Page "${slug}" has no applied SEO; run seo.mjs apply first, then audit.`);
    const rerun = 'Re-run seo-audit.mjs for this page after the last apply, then record that file.';
    if (audit.focusKeyword !== kw) throw fail('EAUDITSTALE', `${file} audited keyword "${audit.focusKeyword ?? ''}", but the applied focus keyword is "${kw}". ${rerun}`);
    if (!p.url) throw fail('EAUDITSTALE', `Page "${slug}" has no url in state; build it first (page.mjs build).`);
    if (!sameUrl(audit.url, p.url)) throw fail('EAUDITSTALE', `${file} audited url ${audit.url ?? '(none)'}, but the page is ${p.url}. ${rerun}`);
    const at = Date.parse(audit.at);
    if (typeof audit.at !== 'string' || Number.isNaN(at)) throw fail('EAUDITSTALE', `${file} has no valid "at" time; it was not written by this seo-audit.mjs. ${rerun}`);
    if (at <= Date.parse(applied)) throw fail('EAUDITSTALE', `${file} was audited at ${audit.at}, before the last SEO apply at ${applied}. ${rerun}`);
    p.seo = { ...p.seo, audit: { pass: audit.pass, file, at: audit.at } };
    if (audit.pass) p.status = 'done';
    status = p.status;
  });
  return { pass: audit.pass, status };
}

const USAGE = 'Usage: node seo.mjs apply <themeDir> <slug> <seo.json> [--force] [--force-organization]\n       node seo.mjs get <themeDir> <slug>\n       node seo.mjs record-audit <themeDir> <slug> <audit.json>\n';
const FLAGS = { apply: ['--force', '--force-organization'], get: [], 'record-audit': [] };
const ARITY = { apply: 3, get: 2, 'record-audit': 3 };

function main(argv) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const pos = argv.filter((a) => !a.startsWith('--'));
  const [cmd, themeDir, slug, file] = pos;
  const usage = () => { process.stderr.write(USAGE); process.exit(64); };
  if (!Object.hasOwn(FLAGS, cmd) || pos.length !== ARITY[cmd] + 1 || flags.some((f) => !FLAGS[cmd].includes(f))) usage();
  const out = (r) => process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (cmd === 'record-audit') return out(recordAudit(themeDir, slug, file));
  if (cmd === 'get') return out(seoGet(createWp(loadRuntime(themeDir)), themeDir, slug));
  let seo;
  try { seo = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw fail('EINPUT', `Cannot read ${file}: ${e.message.split('\n')[0]}`); }
  return out(applySeo(createWp(loadRuntime(themeDir)), themeDir, slug, seo, { force: flags.includes('--force'), forceOrganization: flags.includes('--force-organization') }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
