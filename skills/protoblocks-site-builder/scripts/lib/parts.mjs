#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { blockComment } from './blocks.mjs';

const SCRIPT = path.join(WP_SCRIPTS_DIR, 'parts.php');

export function partMarkup({ block, attrs = {}, navRef }) {
  if (navRef !== undefined && !(Number.isInteger(navRef) && navRef > 0)) throw new Error(`navRef must be a positive integer, got ${String(navRef)}`);
  const inner = navRef === undefined ? undefined : blockComment('navigation', { ref: navRef });
  return `${blockComment(block, attrs, inner)}\n`;
}

export function writePart(themeDir, slug, markup) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Invalid part slug "${slug}"`);
  const file = path.join(themeDir, 'parts', `${slug}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markup);
  return file;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THEME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(code, message, extra = {}) {
  const e = new Error(message);
  e.code = code;
  Object.assign(e, extra);
  throw e;
}
const checkTheme = (theme) => { if (typeof theme !== 'string' || !THEME_RE.test(theme)) fail('ETHEME', `Invalid theme slug ${JSON.stringify(theme)}`); };
const checkSlug = (slug) => { if (typeof slug !== 'string' || !SLUG_RE.test(slug)) fail('ESLUG', `Invalid part slug ${JSON.stringify(slug)} (lowercase letters, digits and single hyphens only)`); };

export function listOverrides(wp, theme) {
  checkTheme(theme);
  return wp.evalFile(SCRIPT, ['overrides', theme]);
}

export function removeOverride(wp, theme, slug, { confirm } = {}) {
  checkTheme(theme);
  checkSlug(slug);
  const rows = wp.evalFile(SCRIPT, ['preview', theme, slug]);
  const ids = rows.map((r) => r.id);
  if (rows.some((r) => r.theme !== theme)) fail('ETHEMEMISMATCH', `Preview returned rows outside theme "${theme}": ${JSON.stringify(rows)}`, { rows });
  if (rows.length > 1) fail('EAMBIGUOUS', `More than one saved "${slug}" part matched (IDs ${ids.join(', ')}). Resolve in wp-admin; nothing was removed.`, { rows });
  if (confirm !== true) {
    fail('ECONFIRM', `The Site Editor has a saved copy of the "${slug}" part. Removing it (to Trash) discards edits made there. Would remove: ${JSON.stringify(rows)}. Ask the developer, then re-run with --confirm.`, { rows });
  }
  return wp.evalFile(SCRIPT, ['remove-override', theme, slug, 'confirm']);
}

function main(argv) {
  const [cmd, themeDir, slug, file] = argv;
  const theme = themeDir ? path.basename(path.resolve(themeDir)) : '';
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'write') return out({ written: writePart(themeDir, slug, fs.readFileSync(file, 'utf8')) });
  const wp = createWp(loadRuntime(themeDir));
  if (cmd === 'overrides') return out(listOverrides(wp, theme));
  if (cmd === 'remove-override') return out(removeOverride(wp, theme, slug, { confirm: argv.includes('--confirm') }));
  process.stderr.write('Usage: node parts.mjs write <themeDir> <slug> <markupFile> | overrides <themeDir> | remove-override <themeDir> <slug> --confirm\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`);
    if (e.rows) process.stdout.write(`${JSON.stringify(e.rows, null, 2)}\n`);
    process.exit(1);
  }
}
