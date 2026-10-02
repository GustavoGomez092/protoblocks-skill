#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFork } from './guards.mjs';

export const MANAGED_START = '// >>> protoblocks-site-builder (managed — do not edit between these markers)';
export const MANAGED_END = '// <<< protoblocks-site-builder';
export const DEFAULT_ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'theme-assets');

const BLOCK = [
  MANAGED_START,
  "foreach ((glob(__DIR__ . '/inc/pb-*.php') ?: []) as $pb_file) {",
  '    require_once $pb_file;',
  '}',
  MANAGED_END,
].join('\n');

function codeError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function ensureManagedBlock(src) {
  const start = src.indexOf(MANAGED_START);
  const end = start === -1 ? src.indexOf(MANAGED_END) : src.indexOf(MANAGED_END, start);
  if ((start === -1) !== (end === -1)) {
    throw codeError('EMANAGEDBLOCK', 'functions.php has a broken protoblocks managed block (start/end markers); fix it by hand — nothing was changed');
  }
  if (start === -1) {
    const body = src.replace(/\s*$/, '');
    if (body.endsWith('?>')) return `${body.slice(0, -2).replace(/\s*$/, '')}\n\n${BLOCK}\n?>\n`;
    return `${body}\n\n${BLOCK}\n`;
  }
  return `${src.slice(0, start)}${BLOCK}${src.slice(end + MANAGED_END.length)}`;
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : [path.relative(base, p)];
  });
}

export function installThemeAssets(themeDir, assetsDir = DEFAULT_ASSETS_DIR) {
  assertFork(themeDir);
  const fnFile = path.join(themeDir, 'functions.php');
  if (!fs.existsSync(fnFile)) throw codeError('ENOFUNCTIONS', `No functions.php in ${themeDir}`);
  const before = fs.readFileSync(fnFile, 'utf8');
  const after = ensureManagedBlock(before); // throws before anything is written
  const copied = [];
  for (const rel of walk(assetsDir)) {
    if (!path.basename(rel).startsWith('pb-')) continue;
    const dest = path.join(themeDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(assetsDir, rel), dest);
    copied.push(rel.split(path.sep).join('/'));
  }
  if (after !== before) fs.writeFileSync(fnFile, after);
  return { copied, functionsUpdated: after !== before };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [cmd, themeDir] = process.argv.slice(2);
  if (cmd !== 'install' || !themeDir) { process.stderr.write('Usage: node theme-assets.mjs install <themeDir>\n'); process.exit(64); }
  process.stdout.write(`${JSON.stringify(installThemeAssets(themeDir), null, 2)}\n`);
}
