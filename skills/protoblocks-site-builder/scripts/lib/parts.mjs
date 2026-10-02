#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';
import { blockComment } from './blocks.mjs';

const SCRIPT = path.join(WP_SCRIPTS_DIR, 'parts.php');

export function partMarkup({ block, attrs = {}, navRef }) {
  const inner = Number.isInteger(navRef) ? blockComment('navigation', { ref: navRef }) : undefined;
  return `${blockComment(block, attrs, inner)}\n`;
}

export function writePart(themeDir, slug, markup) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Invalid part slug "${slug}"`);
  const file = path.join(themeDir, 'parts', `${slug}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markup);
  return file;
}

export const listOverrides = (wp) => wp.evalFile(SCRIPT, ['overrides']);

export function removeOverride(wp, slug, { confirm } = {}) {
  if (!confirm) {
    const e = new Error(`The Site Editor has a saved copy of the "${slug}" part. Removing it discards edits made there. Ask the developer, then re-run with --confirm.`);
    e.code = 'ECONFIRM';
    throw e;
  }
  return wp.evalFile(SCRIPT, ['remove-override', slug]);
}

function main(argv) {
  const [cmd, themeDir, slug, file] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'write') return out({ written: writePart(themeDir, slug, fs.readFileSync(file, 'utf8')) });
  const wp = createWp(loadRuntime(themeDir));
  if (cmd === 'overrides') return out(listOverrides(wp));
  if (cmd === 'remove-override') return out(removeOverride(wp, slug, { confirm: argv.includes('--confirm') }));
  process.stderr.write('Usage: node parts.mjs write <themeDir> <slug> <markupFile> | overrides <themeDir> | remove-override <themeDir> <slug> --confirm\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
