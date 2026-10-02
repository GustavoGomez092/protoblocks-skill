#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPreflight } from './preflight.mjs';
import { createWp } from './wp.mjs';
import { ensurePlugins } from './setup-plugins.mjs';
import { fetchThemeZip, forkTheme } from './theme-fork.mjs';
import { installThemeAssets } from './theme-assets.mjs';
import { initState, updateState, setPath, statePath } from './state.mjs';

const DEFAULT_DEPS = { runPreflight, createWp, ensurePlugins, fetchThemeZip, forkTheme, installThemeAssets };
const USAGE = 'Usage: node setup-site.mjs --name "<Project>" [--slug s] [--site "<Local site>"] [--force] [--update-plugins] [--cwd D]\n';

// `deps` lets tests inject fakes; production callers omit it.
export async function setupSite({ cwd = process.cwd(), site, name, slug, force = false, updatePlugins = false }, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const preflight = d.runPreflight({ cwd, site });
  const fatal = preflight.checks.filter((c) => c.status === 'fail');
  if (fatal.length) {
    const e = new Error(`Preflight failed:\n${fatal.map((c) => `- ${c.id}: ${c.detail}${c.fix ? ` -> ${c.fix}` : ''}`).join('\n')}`);
    e.code = 'EPREFLIGHT';
    throw e;
  }
  const wp = d.createWp(preflight);
  const plugins = await d.ensurePlugins(wp, { updatePlugins });
  const { zipFile, forkedFrom, cleanup } = await d.fetchThemeZip();
  let theme;
  let assets;
  try {
    theme = d.forkTheme({ wp, themesDir: path.join(preflight.publicPath, 'wp-content', 'themes'), name, slug, force, zipFile, forkedFrom });
    assets = d.installThemeAssets(theme.themeDir);
  } finally {
    cleanup();
  }

  const siteState = {
    url: preflight.url,
    path: preflight.publicPath,
    wp: preflight.mode === 'local-wrapper' ? { mode: 'local-wrapper', wrapper: preflight.wp } : { mode: 'native' },
    theme: { slug: theme.slug, forkedFrom: theme.forkedFrom },
    ...(preflight.localSite ? { localSiteId: preflight.localSite.id } : {}),
  };
  if (fs.existsSync(statePath(theme.themeDir))) {
    updateState(theme.themeDir, (s) => { setPath(s, 'site.theme', siteState.theme); setPath(s, 'site.url', siteState.url); });
  } else {
    initState(theme.themeDir, siteState);
  }
  return { preflight: { mode: preflight.mode, url: preflight.url, checks: preflight.checks }, plugins, theme, assets, stateFile: statePath(theme.themeDir) };
}

const VALUE_FLAGS = new Set(['name', 'slug', 'site', 'cwd']);

export function parseArgs(argv) {
  const usage = (msg) => Object.assign(new Error(msg), { code: 'EUSAGE' });
  const a = { force: false, updatePlugins: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') a.force = true;
    else if (arg === '--update-plugins') a.updatePlugins = true;
    else if (arg.startsWith('--') && VALUE_FLAGS.has(arg.slice(2))) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw usage(`${arg} needs a value`);
      a[arg.slice(2)] = v;
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
  const r = await setupSite({ cwd: a.cwd ?? process.cwd(), site: a.site, name: a.name, slug: a.slug, force: a.force, updatePlugins: a.updatePlugins });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
