#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

export const renderTitle = (t) => String(t).replace(/%%sep%%/g, '-').replace(/%%sitename%%/g, '');
const val = (leaf) => leaf?.value;

export function validateSeo(seo) {
  if (!seo || typeof seo !== 'object' || Array.isArray(seo)) return ['seo: must be an object of {value, inferred} leaves'];
  const errors = [];
  for (const [k, leaf] of Object.entries(seo)) {
    if (!leaf || typeof leaf !== 'object' || typeof leaf.inferred !== 'boolean') errors.push(`${k}: needs {value, inferred}`);
    else if (leaf.inferred && !leaf.why) errors.push(`${k}: inferred values need a "why"`);
  }
  const kw = val(seo.focusKeyword);
  if (typeof kw !== 'string' || kw !== kw.toLowerCase() || kw.trim().split(/\s+/).length > 4 || !kw.trim()) errors.push('focusKeyword: 1–4 lowercase words');
  else if (/[%<>]/.test(kw)) errors.push('focusKeyword: must not contain %, < or >');
  const title = val(seo.title);
  if (typeof title !== 'string' || !title.trim()) errors.push('title: required');
  else if (renderTitle(title).length > 60) errors.push(`title: renders to ${renderTitle(title).length} chars (max 60 before the site name)`);
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
      'opengraph-title': renderTitle(title),
      'opengraph-description': desc,
      'opengraph-image-id': ogImageId,
      'twitter-title': renderTitle(title),
      'twitter-description': desc,
      'twitter-image-id': ogImageId,
      schema_page_type: val(seo.schemaPageType) ?? 'WebPage',
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

function yoastError(wp, args) {
  const out = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'yoast.php'), args);
  if (out?.error) throw fail(out.error.code ?? 'EYOAST', out.error.message ?? 'Yoast writer failed');
  return out;
}

export function applySeo(wp, themeDir, slug, seo, { forceOrganization = false, index = true } = {}) {
  const errors = validateSeo(seo);
  if (errors.length) throw fail('ESEO', `Invalid SEO:\n- ${errors.join('\n- ')}`);
  const page = loadState(themeDir).pages.find((p) => p.slug === slug);
  if (!page) throw fail('ENOPAGE', `No page "${slug}" in state.`);
  if (!Number.isInteger(page.postId) || page.postId <= 0) throw fail('ENOPAGE', `Page "${slug}" has no postId; build it first.`);
  // Validate every input before the first import so a bad path cannot leave a half-applied run.
  const ogFile = val(seo.ogImage)?.file;
  if (ogFile !== undefined) requireFile(ogFile, 'ogImage.file');
  const org = val(seo.organization);
  if (org?.logo?.file !== undefined) requireFile(org.logo.file, 'organization.logo.file');
  const media = [];
  let ogImageId = val(seo.ogImage)?.id ?? null;
  if (ogFile) {
    const m = importMedia(wp, ogFile, { alt: page.title ?? slug });
    ogImageId = m.id;
    media.push({ role: 'ogImage', id: m.id, reused: m.reused });
  }
  let organizationLogoId = org?.logo?.id ?? null;
  if (org?.logo?.file) {
    const m = importMedia(wp, org.logo.file, { alt: `${org.name} logo` });
    organizationLogoId = m.id;
    media.push({ role: 'organizationLogo', id: m.id, reused: m.reused });
  }
  const spec = buildYoastSpec({ postId: page.postId, seo, ogImageId, organizationLogoId, forceOrganization });
  // No schema leaf leaves the page's existing JSON-LD untouched; an explicit empty array clears it.
  let jsonld = 'none';
  if (!spec.jsonld) delete spec.jsonld;
  else if (spec.jsonld.length > 0) {
    jsonld = jsonldSupported(wp) ? 'written' : 'unsupported';
    if (jsonld === 'unsupported') delete spec.jsonld;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-seo-'));
  const file = path.join(dir, 'spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  let result;
  try { result = yoastError(wp, ['apply', file]); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (index) {
    const idx = wp.run(['yoast', 'index', '--skip-confirmation']);
    result.index = idx.code === 0 ? 'ok' : `failed: ${(idx.stderr || idx.stdout).trim().slice(0, 300)}`;
  } else result.index = 'skipped';
  result.jsonld = jsonld;
  result.media = media;
  updateState(themeDir, (s) => {
    const p = s.pages.find((x) => x.slug === slug);
    if (p) p.seo = { ...seo, applied: new Date().toISOString(), ogImageId };
  });
  return result;
}

export function recordAudit(themeDir, slug, auditFile) {
  const file = path.resolve(auditFile);
  let audit;
  try { audit = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw fail('EINPUT', `Cannot read audit file ${file}: ${e.message}`); }
  if (!audit || typeof audit !== 'object' || Array.isArray(audit) || typeof audit.pass !== 'boolean') throw fail('EINPUT', `${file} is not an audit result (expected an object with a boolean "pass").`);
  let status;
  updateState(themeDir, (s) => {
    const p = s.pages.find((x) => x.slug === slug);
    if (!p) throw fail('ENOPAGE', `No page "${slug}" in state.`);
    p.seo = { ...(p.seo ?? {}), audit: { pass: audit.pass, file, at: new Date().toISOString() } };
    if (audit.pass) p.status = 'done';
    status = p.status;
  });
  return { pass: audit.pass, status };
}

const USAGE = 'Usage: node seo.mjs apply <themeDir> <slug> <seo.json> [--force-organization]\n       node seo.mjs record-audit <themeDir> <slug> <audit.json>\n';

function main(argv) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const [cmd, themeDir, slug, file] = argv.filter((a) => !a.startsWith('--'));
  if (!['apply', 'record-audit'].includes(cmd) || !themeDir || !slug || !file) { process.stderr.write(USAGE); process.exit(64); }
  const out = (r) => process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (cmd === 'record-audit') return out(recordAudit(themeDir, slug, file));
  let seo;
  try { seo = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw fail('EINPUT', `Cannot read ${file}: ${e.message.split('\n')[0]}`); }
  return out(applySeo(createWp(loadRuntime(themeDir)), themeDir, slug, seo, { forceOrganization: flags.includes('--force-organization') }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
