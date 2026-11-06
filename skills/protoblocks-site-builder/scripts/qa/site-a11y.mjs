#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, stateDir } from '../lib/state.mjs';
import { a11yForPage, blockingRulesFrom } from './a11y.mjs';

export const PROBE_PATH = '__pb-404-probe__';
export const PROBE_SLUG = '__404__';
// The frame widths page QA would use when no page has a design frame: desktop and the narrowest common phone.
export const DEFAULT_WIDTHS = Object.freeze([{ name: 'desktop', width: 1440 }, { name: 'mobile', width: 390 }]);

const fail = (code, message) => Object.assign(new Error(message), { code });

/** Union of every page's design frame widths, widest first (patterns and the post-navigation pass run at the first). */
export function siteWidths(state) {
  const byWidth = new Map();
  for (const p of state.pages ?? []) {
    for (const f of p.design?.frames ?? []) {
      if (Number.isFinite(f?.width) && f.width > 0 && !byWidth.has(f.width)) byWidth.set(f.width, { name: String(f.breakpoint ?? f.width), width: f.width });
    }
  }
  return byWidth.size ? [...byWidth.values()].sort((a, b) => b.width - a.width) : DEFAULT_WIDTHS.map((w) => ({ ...w }));
}

/** Every page in state with a url, then the 404 probe under the site url. */
export function siteTargets(state) {
  const pages = (state.pages ?? []).filter((p) => typeof p.url === 'string' && p.url.trim()).map((p) => ({ slug: p.slug, url: p.url }));
  const home = String(state.site?.url ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(home)) throw fail('EINPUT', `site.url must be an http(s) URL to place the 404 probe (got ${JSON.stringify(state.site?.url ?? null)}).`);
  return [...pages, { slug: PROBE_SLUG, url: `${home}/${PROBE_PATH}`, probe: true }];
}

// The probe must answer 404 (a 200 means the theme serves content at any URL); every other page must answer below 400.
const statusOk = (t, status) => (t.probe ? status === 404 : Number.isInteger(status) && status < 400);

export async function siteA11y(themeDir, { out, browser } = {}) {
  if (typeof themeDir !== 'string' || !fs.existsSync(themeDir) || !fs.statSync(themeDir).isDirectory()) throw fail('ENOTHEME', `${themeDir} is not a directory`);
  const state = loadState(themeDir);
  const blockingRules = blockingRulesFrom(state.site.qa);
  const widths = siteWidths(state);
  const targets = siteTargets(state);
  const file = path.resolve(out ?? path.join(stateDir(themeDir), 'artifacts', 'site-a11y.json'));
  const { launchBrowser, openPage } = await import('./browser.mjs');
  const own = !browser;
  const b = browser ?? await launchBrowser();
  const pages = [];
  try {
    for (const t of targets) {
      const diagnostics = {};
      const a = await a11yForPage({ browser: b, openPage, url: t.url, widths, blockingRules, diagnostics });
      const status = diagnostics.status ?? null;
      const a11yOk = a.error === undefined && a.blocking.length === 0 && a.patterns.length === 0 && a.afterNavigation?.pass !== false;
      pages.push({
        slug: t.slug, url: t.url, status,
        blocking: a.blocking, other: a.other, patterns: a.patterns, afterNavigation: a.afterNavigation,
        ...(a.error !== undefined ? { error: a.error } : {}),
        pass: a11yOk && statusOk(t, status),
      });
    }
  } finally { if (own) await b.close().catch(() => {}); }
  const result = { pages, pass: pages.every((p) => p.pass), file };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const USAGE = 'Usage: node site-a11y.mjs run <themeDir> [--out file]\n';

async function main(argv) {
  const [cmd, ...rest] = argv;
  let out;
  const i = rest.indexOf('--out');
  if (i >= 0) {
    out = rest[i + 1];
    rest.splice(i, 2);
  }
  if (cmd !== 'run' || rest.length !== 1 || rest[0].startsWith('--') || (i >= 0 && (!out || out.startsWith('--')))) {
    process.stderr.write(USAGE);
    process.exit(64);
  }
  const r = await siteA11y(rest[0], { out });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (!r.pass) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
