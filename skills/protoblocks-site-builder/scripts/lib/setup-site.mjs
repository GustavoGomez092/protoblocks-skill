#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPreflight } from './preflight.mjs';
import { createWp, assertStateSite } from './wp.mjs';
import { ensurePlugins } from './setup-plugins.mjs';
import { fetchThemeZip, forkTheme, inspectThemeDir, slugify, ForkError } from './theme-fork.mjs';
import { installThemeAssets } from './theme-assets.mjs';
import { initState, updateState, setPath, statePath } from './state.mjs';

const DEFAULT_DEPS = { runPreflight, createWp, ensurePlugins, fetchThemeZip, forkTheme, installThemeAssets };
const USAGE = 'Usage: node setup-site.mjs --name "<Project>" [--slug s] [--theme-name "<display name>"] [--category-title "<title>"] [--logo <file.svg|png>] [--readme] [--site "<Local site>"] [--force] [--refork <slug>] [--update-plugins] [--cwd D]\n';

// ---- the fork's README and logo ----

const LOGO_EXT = { '.svg': 'svg', '.png': 'png' };
const fail = (code, message) => Object.assign(new Error(message), { code });
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** An SVG logo as a theme asset: no xml prolog, doctype or comments; no id, x, y, version or xml:space on the root. */
export function cleanSvg(svg) {
  let out = String(svg).replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>\s*/gi, '').replace(/<!DOCTYPE[^>]*>\s*/gi, '').replace(/<!--[\s\S]*?-->\s*/g, '');
  out = out.replace(/<svg\b([^>]*)>/i, (m, attrs) => `<svg${attrs.replace(/\s+(?:id|x|y|version|xml:space)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')}>`);
  return `${out.trim()}\n`;
}

/** Copies the client logo to `<themeDir>/assets/img/logo.<svg|png>` (SVG cleaned) and returns its theme-relative path. */
export function installLogo(themeDir, file) {
  const ext = LOGO_EXT[path.extname(String(file)).toLowerCase()];
  if (!ext) throw fail('EINPUT', `--logo must be an .svg or .png file, got ${JSON.stringify(file)}`);
  let data;
  try { data = fs.readFileSync(file); } catch (e) { throw fail('EINPUT', `Cannot read --logo ${file}: ${e.message}`); }
  if (!data.length) throw fail('EINPUT', `--logo ${file} is empty`);
  const rel = `assets/img/logo.${ext}`;
  const target = path.join(themeDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, ext === 'svg' ? cleanSvg(data.toString('utf8')) : data);
  return { rel, file: target };
}

/** The client README the fork gets instead of the base theme's: the logo (when there is one), the display name, one line. */
export function readmeContent({ displayName, projectName, logo }) {
  const img = logo ? `<p align="center">\n  <img src="${logo}" alt="${escapeAttr(displayName)}" width="360">\n</p>\n\n` : '';
  return `${img}# ${displayName}\n\nWordPress block theme for ${projectName}, powered by [Proto-Blocks](https://github.com/GustavoGomez092/Proto-Blocks).\n`;
}

/**
 * Writes `<themeDir>/README.md`. On a fresh fork the inherited README is replaced. On an existing fork the file is
 * replaced only when it is byte-for-byte what this tool last wrote (`storedHash`, `site.theme.readmeHash`): a README
 * nobody recorded, or one edited since, is refused with EEDITED unless `force`.
 */
export function writeReadme(themeDir, { displayName, projectName, logo, fresh = false, force = false, storedHash }) {
  const file = path.join(themeDir, 'README.md');
  const content = readmeContent({ displayName, projectName, logo });
  if (!fresh && fs.existsSync(file) && !force) {
    const current = sha256(fs.readFileSync(file, 'utf8'));
    if (current !== sha256(content)) {
      if (storedHash === undefined) throw fail('EEDITED', `${file} was not written by setup-site.mjs (no site.theme.readmeHash); refusing to replace it. Re-run with --force to overwrite it.`);
      if (current !== storedHash) throw fail('EEDITED', `${file} was edited since setup-site.mjs wrote it; refusing to replace it. Keep it, or re-run with --force to overwrite it.`);
    }
  }
  fs.writeFileSync(file, content);
  return { file, hash: sha256(content), logo: logo ?? null };
}

// `deps` lets tests inject fakes; production callers omit it.
// `themeName` (default `name`) is the theme's display name; `categoryTitle` (default "<themeName> blocks") titles the
// Proto-Blocks inserter category, whose slug is the theme slug. On an existing fork they are written only when passed.
// `logo` (an .svg/.png file) is copied into the fork as `assets/img/logo.<ext>` and recorded as `site.theme.logo`. The
// client README is written on a fresh fork, or on an existing one with `readme: true` (never over a README someone edited:
// EEDITED unless `force`).
export async function setupSite({ cwd = process.cwd(), site, name, slug, force = false, refork, updatePlugins = false, themeName, categoryTitle, logo, readme = false }, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const preflight = d.runPreflight({ cwd, site });
  const fatal = preflight.checks.filter((c) => c.status === 'fail');
  if (fatal.length) {
    const e = new Error(`Preflight failed:\n${fatal.map((c) => `- ${c.id}: ${c.detail}${c.fix ? ` -> ${c.fix}` : ''}`).join('\n')}`);
    e.code = 'EPREFLIGHT';
    throw e;
  }
  const themeSlug = slug ?? slugify(name);
  if (refork !== undefined && refork !== themeSlug) {
    throw new ForkError(`--refork must repeat the theme slug exactly ("${themeSlug}"), got ${JSON.stringify(refork)}; nothing was changed.`, 'ERFORK');
  }
  const themesDir = path.join(preflight.publicPath, 'wp-content', 'themes');
  // Refuse before touching anything when the fork's build state was made for another site.
  assertStateSite(path.join(themesDir, themeSlug), preflight);
  // An existing fork is reused as-is, so it needs no download (re-runs work offline).
  const reusable = refork === undefined && Boolean(inspectThemeDir(path.join(themesDir, themeSlug)).marker);

  const wp = d.createWp(preflight);
  const plugins = await d.ensurePlugins(wp, { updatePlugins });
  const forkOpts = { wp, themesDir, name, slug, force, ...(refork !== undefined ? { refork } : {}), ...(themeName !== undefined ? { themeName } : {}), ...(categoryTitle !== undefined ? { categoryTitle } : {}) };
  let theme;
  let assets;
  if (reusable) {
    theme = d.forkTheme(forkOpts);
    assets = d.installThemeAssets(theme.themeDir);
  } else {
    const { zipFile, forkedFrom, cleanup } = await d.fetchThemeZip();
    try {
      theme = d.forkTheme({ ...forkOpts, zipFile, forkedFrom });
      assets = d.installThemeAssets(theme.themeDir);
    } finally {
      cleanup();
    }
  }

  const siteState = {
    url: preflight.url,
    path: preflight.publicPath,
    wp: preflight.mode === 'local-wrapper' ? { mode: 'local-wrapper', wrapper: preflight.wp } : { mode: 'native' },
    theme: { slug: theme.slug, forkedFrom: theme.forkedFrom, ...(theme.displayName ? { displayName: theme.displayName } : {}), ...(theme.category ? { category: theme.category } : {}) },
    ...(preflight.localSite ? { localSiteId: preflight.localSite.id } : {}),
  };
  if (fs.existsSync(statePath(theme.themeDir))) {
    assertStateSite(theme.themeDir, preflight);
    updateState(theme.themeDir, (s) => {
      // site.theme is merged so a recorded screenshot survives a re-run.
      setPath(s, 'site.theme', { ...(s.site.theme ?? {}), ...siteState.theme });
      for (const k of ['path', 'wp']) setPath(s, `site.${k}`, siteState[k]);
      if (siteState.localSiteId) setPath(s, 'site.localSiteId', siteState.localSiteId);
    });
  } else {
    initState(theme.themeDir, siteState);
  }
  // The logo and README, recorded in the same state write (the README hash is what a later run compares against).
  const logoRel = logo !== undefined ? installLogo(theme.themeDir, logo).rel : undefined;
  const writeIt = theme.reused !== true || readme === true;
  let readmeOut = null;
  if (logoRel !== undefined || writeIt) {
    updateState(theme.themeDir, (s) => {
      if (logoRel !== undefined) setPath(s, 'site.theme.logo', logoRel);
      if (!writeIt) return;
      const displayName = theme.displayName ?? s.site.theme?.displayName ?? name;
      readmeOut = writeReadme(theme.themeDir, { displayName, projectName: name, logo: logoRel ?? s.site.theme?.logo, fresh: theme.reused !== true, force, storedHash: s.site.theme?.readmeHash });
      setPath(s, 'site.theme.readmeHash', readmeOut.hash);
    });
  }
  return { preflight: { mode: preflight.mode, url: preflight.url, checks: preflight.checks }, plugins, theme, assets, ...(logoRel !== undefined ? { logo: logoRel } : {}), readme: readmeOut, stateFile: statePath(theme.themeDir) };
}

const VALUE_FLAGS = new Set(['name', 'slug', 'site', 'cwd', 'refork', 'theme-name', 'category-title', 'logo']);
const FLAG_KEYS = { 'theme-name': 'themeName', 'category-title': 'categoryTitle' };

export function parseArgs(argv) {
  const usage = (msg) => Object.assign(new Error(msg), { code: 'EUSAGE' });
  const a = { force: false, updatePlugins: false, readme: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') a.force = true;
    else if (arg === '--readme') a.readme = true;
    else if (arg === '--update-plugins') a.updatePlugins = true;
    else if (arg.startsWith('--') && VALUE_FLAGS.has(arg.slice(2))) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw usage(`${arg} needs a value`);
      a[FLAG_KEYS[arg.slice(2)] ?? arg.slice(2)] = v;
      i++;
    } else throw usage(`Unknown argument ${arg}`);
  }
  if (!a.name) throw usage('--name is required');
  return a;
}

async function main(argv) {
  let a;
  try { a = parseArgs(argv); } catch (e) {
    process.stderr.write(`${e.message}\n${USAGE}`);
    process.exit(64);
  }
  const r = await setupSite({ cwd: a.cwd ?? process.cwd(), site: a.site, name: a.name, slug: a.slug, force: a.force, refork: a.refork, updatePlugins: a.updatePlugins, themeName: a.themeName, categoryTitle: a.categoryTitle, logo: a.logo, readme: a.readme });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
