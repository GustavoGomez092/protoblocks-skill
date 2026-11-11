#!/usr/bin/env node
// The custom 404 page: every site gets one once its first page finished its design and QA steps (status.mjs routes
// `not-found` until `site.notFound.check.pass` is recorded). `write` wraps block markup in the theme's page shell
// (header part, Taxi wrapper, <main>, footer part) as templates/404.html; `check` loads a missing URL in Playwright at
// the site's widths and verifies the response and the page; `record` stores the check after the developer approved
// the screenshots.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, stateDir } from './state.mjs';
import { assertFork } from './guards.mjs';

export const TEMPLATE_FILE = 'templates/404.html';
// Same path site-a11y.mjs probes (tested equal): a slug no site has, answered with the 404 template.
export const PROBE_PATH = '__pb-404-probe__';
export const ARTIFACTS_DIR = '404';
// What a 404 page must hold besides a 404 status: the Taxi view (a swap to a missing URL lands here), one <main>, an
// h1 with text and a way back (a link to the home URL inside main).
export const CHECKS = Object.freeze(['status', 'error404', 'taxi', 'main', 'h1', 'homeLink', 'pageErrors', 'images']);

const fail = (code, message) => Object.assign(new Error(message), { code });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const BLOCK_RE = /<!--\s*wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)[\s/]/;

/** The outermost block of the content, without the default proto-blocks/ namespace. */
export function contentBlock(markup) {
  const m = BLOCK_RE.exec(String(markup));
  return m ? m[1].replace(/^proto-blocks\//, '') : null;
}

/**
 * templates/404.html: the header part, the Taxi wrapper, <main> (full width, default layout, no block gap, like
 * proto-blocks-theme's page.html) holding `content`, the footer part.
 */
export function notFoundTemplate(content) {
  const body = String(content ?? '').trim();
  if (!BLOCK_RE.test(body)) throw fail('EINPUT', 'The 404 content must be block markup (at least one <!-- wp:… --> block).');
  if (/<!--\s*wp:template-part\b/.test(body)) throw fail('EINPUT', 'Pass only the main content: the template adds the header and footer parts itself.');
  if (/data-taxi/.test(body)) throw fail('EINPUT', 'Pass only the main content: the template adds the Taxi wrapper itself.');
  if (/<main[\s>]/i.test(body)) throw fail('EINPUT', 'Pass only the main content: the template prints <main> itself (one landmark per page).');
  const indented = body.split('\n').map((l) => (l.trim() ? `\t\t\t${l}` : '')).join('\n');
  return [
    '<!-- wp:template-part {"slug":"header","tagName":"header"} /-->',
    '',
    '<div data-taxi>',
    '\t<div data-taxi-view>',
    '\t\t<!-- wp:group {"tagName":"main","align":"full","style":{"spacing":{"blockGap":"0"}},"layout":{"type":"default"}} -->',
    '\t\t<main class="wp-block-group alignfull">',
    indented,
    '\t\t</main>',
    '\t\t<!-- /wp:group -->',
    '\t</div>',
    '</div>',
    '',
    '<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->',
    '',
  ].join('\n');
}

/**
 * Writes templates/404.html from the block markup in `contentFile` and records `site.notFound` ({template, block,
 * contentHash, writtenAt}); an earlier `check` is dropped (the page changed). Refuses with EEDITED when the file exists
 * and is not the one it last wrote (edited by hand, or written before this tool existed) unless `force`.
 */
export function writeNotFound(themeDir, contentFile, { force = false } = {}) {
  assertFork(themeDir);
  const state = loadState(themeDir);
  const abs = path.resolve(contentFile);
  let content;
  try { content = fs.readFileSync(abs, 'utf8'); } catch (e) { throw fail('EINPUT', `Cannot read the 404 content ${abs}: ${e.message}`); }
  const template = notFoundTemplate(content);
  const file = path.join(themeDir, TEMPLATE_FILE);
  if (fs.existsSync(file) && !force) {
    const current = fs.readFileSync(file, 'utf8');
    const recorded = state.site.notFound?.contentHash;
    if (current !== template && (!recorded || sha(current) !== recorded)) {
      throw fail('EEDITED', `${file} exists and was not written by not-found.mjs (${recorded ? 'edited since' : 'no record in state'}); nothing was written. Keep it (move its markup into the content file) or re-run with --force to overwrite it.`);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, template);
  const block = contentBlock(content);
  const writtenAt = new Date().toISOString();
  updateState(themeDir, (s) => {
    s.site.notFound = { template: TEMPLATE_FILE, ...(block ? { block } : {}), contentHash: sha(template), writtenAt };
  });
  return { file, block, writtenAt };
}

/** The site's probe URL: a slug no page has, under site.url. */
export function probeUrl(state) {
  const home = String(state.site?.url ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(home)) throw fail('EINPUT', `site.url must be an http(s) URL to place the 404 probe (got ${JSON.stringify(state.site?.url ?? null)}).`);
  return `${home}/${PROBE_PATH}`;
}

// Evaluated in the page: what the 404 page holds.
function inspect(homeHref) {
  const main = document.querySelectorAll('main, [role="main"]');
  const first = main[0] ?? null;
  const h1 = first ? first.querySelector('h1') : null;
  const home = new URL(homeHref);
  const samePath = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  const links = first ? [...first.querySelectorAll('a[href]')] : [];
  const homeLink = links.some((a) => { try { const u = new URL(a.href); return u.origin === home.origin && samePath(u.pathname, home.pathname) && !u.hash; } catch { return false; } });
  return {
    error404: document.body.classList.contains('error404'),
    taxi: !!document.querySelector('[data-taxi] [data-taxi-view]'),
    main: main.length,
    h1: h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '',
    links: links.length,
    homeLink,
    title: document.title,
  };
}

/**
 * Loads the probe URL at every site width (the pages' design frame widths; desktop 1440 and mobile 390 without any),
 * screenshots it (full page) into artifacts/404/<name>.png and verifies: HTTP 404, body.error404, the Taxi view, one
 * <main>, an h1 with text, a link back to the home URL inside main, no page errors, no broken images. Writes
 * artifacts/404/check.json (or `out`) and returns the result; `pass` only when every viewport passes.
 */
export async function checkNotFound(themeDir, { out, browser } = {}) {
  if (typeof themeDir !== 'string' || !fs.existsSync(themeDir) || !fs.statSync(themeDir).isDirectory()) throw fail('ENOTHEME', `${themeDir} is not a directory`);
  const state = loadState(themeDir);
  const url = probeUrl(state);
  const home = String(state.site.url).replace(/\/+$/, '') + '/';
  const dir = path.join(stateDir(themeDir), 'artifacts', ARTIFACTS_DIR);
  const file = path.resolve(out ?? path.join(dir, 'check.json'));
  fs.mkdirSync(dir, { recursive: true });
  const { siteWidths } = await import('../qa/site-a11y.mjs');
  const { launchBrowser, openPage } = await import('../qa/browser.mjs');
  const widths = siteWidths(state);
  const own = !browser;
  const b = browser ?? await launchBrowser();
  const viewports = [];
  try {
    for (const w of widths) {
      let opened;
      try {
        opened = await openPage(b, { url, width: w.width });
      } catch (e) {
        viewports.push({ name: w.name, width: w.width, status: e.status ?? null, error: `${e.code ? `[${e.code}] ` : ''}${e.message}`, pageErrors: e.pageErrors ?? [], consoleErrors: e.consoleErrors ?? [], pass: false });
        continue;
      }
      const { page, context, errors, status } = opened;
      try {
        const found = await page.evaluate(inspect, home);
        const screenshot = path.join(dir, `${w.name}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        const failed = [];
        if (status !== 404) failed.push(`status ${status} (expected 404)`);
        if (!found.error404) failed.push('body has no error404 class (WordPress did not treat it as a 404)');
        if (!found.taxi) failed.push('no [data-taxi] > [data-taxi-view] wrapper (a swap to a missing URL would find no view)');
        if (found.main !== 1) failed.push(`${found.main} <main> landmarks (expected 1)`);
        if (!found.h1) failed.push('no h1 with text inside main');
        if (!found.homeLink) failed.push(`no link to the home URL (${home}) inside main`);
        if (errors.page.length) failed.push(`${errors.page.length} page error(s)`);
        if (errors.images.length) failed.push(`${errors.images.length} broken image(s)`);
        viewports.push({
          name: w.name, width: w.width, status, ...found, screenshot,
          pageErrors: errors.page, consoleErrors: errors.console, imageErrors: errors.images, stalled: errors.stalled,
          failed, pass: failed.length === 0,
        });
      } finally { await context.close().catch(() => {}); }
    }
  } finally { if (own) await b.close().catch(() => {}); }
  const result = { url, home, template: state.site.notFound?.template ?? null, viewports, screenshots: viewports.filter((v) => v.screenshot).map((v) => v.screenshot), pass: viewports.length > 0 && viewports.every((v) => v.pass), at: new Date().toISOString(), file };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/**
 * Records a passing check the developer approved: `site.notFound.check = {pass, file, at, approvedBy}`. Refuses a
 * failing check (ECHECK), one made before the template was last written (ESTALE), one for another site (EINPUT), a
 * site whose template was never written through `write` (ESTATUS), and any record without `--approved` (EAPPROVAL):
 * the developer must have seen the screenshots.
 */
export function recordNotFound(themeDir, file, { approved = false } = {}) {
  const abs = path.resolve(file);
  let r;
  try { r = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { throw fail('EINPUT', `Cannot read the 404 check ${abs}: ${e.message}`); }
  if (!isObj(r)) throw fail('EINPUT', `404 check ${abs} is not a JSON object.`);
  let result;
  updateState(themeDir, (s) => {
    const nf = s.site.notFound;
    if (!isObj(nf) || typeof nf.template !== 'string') throw fail('ESTATUS', 'templates/404.html was never written through not-found.mjs write; write it first, then check and record.');
    const expected = probeUrl(s);
    if (r.url !== expected) throw fail('EINPUT', `${abs} checked ${JSON.stringify(r.url ?? null)}, not this site's probe ${expected}; re-run not-found.mjs check.`);
    if (typeof r.at !== 'string' || typeof nf.writtenAt !== 'string' || r.at < nf.writtenAt) throw fail('ESTALE', `${abs} predates the template written at ${nf.writtenAt}; re-run not-found.mjs check.`);
    if (r.pass !== true) {
      const why = (r.viewports ?? []).filter((v) => !v.pass).map((v) => `${v.name}: ${v.error ?? (v.failed ?? []).join('; ')}`).join(' | ');
      throw fail('ECHECK', `The 404 check failed (${why || 'no viewports'}); fix the page, re-run not-found.mjs check, and record a passing one.`);
    }
    if (!approved) throw fail('EAPPROVAL', `Show the developer the screenshots (${(r.screenshots ?? []).join(', ') || 'none'}) and record with --approved only after they approve the page.`);
    nf.check = { pass: true, file: abs, at: new Date().toISOString(), approvedBy: 'developer' };
    result = { pass: true, approved: true, template: nf.template, at: nf.check.at };
  });
  return result;
}

const USAGE = [
  'Usage: node not-found.mjs write <themeDir> <content.html> [--force]',
  '       node not-found.mjs check <themeDir> [--out <file>]',
  '       node not-found.mjs record <themeDir> <check.json> --approved',
  '',
].join('\n');

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = new Set();
  let out;
  const args = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { out = rest[i + 1]; i += 1; } else if (a.startsWith('--')) flags.add(a); else args.push(a);
  }
  const bad = () => { process.stderr.write(USAGE); process.exit(64); };
  if (cmd === 'write') {
    if (args.length !== 2 || out !== undefined || [...flags].some((f) => f !== '--force')) bad();
    return writeNotFound(args[0], args[1], { force: flags.has('--force') });
  }
  if (cmd === 'check') {
    if (args.length !== 1 || flags.size || (out !== undefined && (!out || out.startsWith('--')))) bad();
    const r = await checkNotFound(args[0], { out });
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    process.exit(r.pass ? 0 : 1);
  }
  if (cmd === 'record') {
    if (args.length !== 2 || out !== undefined || [...flags].some((f) => f !== '--approved')) bad();
    return recordNotFound(args[0], args[1], { approved: flags.has('--approved') });
  }
  return bad();
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2))
    .then((r) => { if (r !== undefined) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); })
    .catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
