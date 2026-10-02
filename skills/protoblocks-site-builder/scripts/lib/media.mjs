#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime, WP_SCRIPTS_DIR } from './wp.mjs';

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg']);
const MAX_ALT = 1000;
const MAX_TITLE = 200;
const SVG_MESSAGE = 'SVG uploads are disabled on this site; convert to PNG or inline the SVG in the template';

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);

function validate(file, alt, title) {
  if (typeof alt !== 'string') {
    throw fail('EALT', `Alt text is required for ${file} (pass '' only for purely decorative images).`);
  }
  if (alt.length > MAX_ALT) throw fail('EALT', `Alt text for ${file} is ${alt.length} characters; the limit is ${MAX_ALT}.`);
  if (typeof title !== 'string') throw fail('EUSAGE', `Title for ${file} must be a string.`);
  if (title.length > MAX_TITLE) throw fail('ETITLE', `Title for ${file} is ${title.length} characters; the limit is ${MAX_TITLE}.`);
  let real;
  try {
    real = fs.realpathSync(path.resolve(file));
  } catch {
    throw fail('EFILE', `Cannot read ${file}: no such file.`);
  }
  if (!fs.statSync(real).isFile()) throw fail('EFILE', `${file} is not a regular file.`);
  const ext = path.extname(real).toLowerCase();
  if (!EXTENSIONS.has(ext)) {
    throw fail('ETYPE', `${file}: unsupported type '${ext || 'none'}'; use one of ${[...EXTENSIONS].map((e) => e.slice(1)).join(', ')}.`);
  }
  return real;
}

/**
 * The only argv passed to WP-CLI is `import <base64url JSON>`: WP-CLI parses positional args starting with `--`
 * as its own flags, so alt/title text must never travel as raw argv.
 */
export function importMedia(wp, file, { alt, title = '' } = {}) {
  const real = validate(file, alt, title);
  const payload = Buffer.from(JSON.stringify({ file: real, alt, title }), 'utf8').toString('base64url');
  const out = wp.evalFile(path.join(WP_SCRIPTS_DIR, 'media.php'), ['import', payload]);
  if (out?.error) {
    const { code = 'EMEDIA', message, id } = out.error;
    if (code === 'ETYPE' && path.extname(real).toLowerCase() === '.svg') throw fail('ETYPE', SVG_MESSAGE);
    throw fail(code, id ? `${message} (attachment id ${id} was created)` : message, id ? { id } : {});
  }
  return out;
}

export const imageAttr = (m) => ({ id: m.id, url: m.url, alt: m.alt, caption: '', size: 'full' });

/** Returns { alt?, title? } (null = flag given without a value) or null for unknown/stray arguments. */
export function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const m = /^--(alt|title)(?:=([\s\S]*))?$/.exec(args[i]);
    if (!m) return null;
    if (m[2] !== undefined) { flags[m[1]] = m[2]; continue; }
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) flags[m[1]] = null;
    else { flags[m[1]] = next; i++; }
  }
  return flags;
}

const USAGE = 'Usage: node media.mjs import <themeDir> <file> --alt "<text>" [--title T]\n';

function main(argv) {
  const [cmd, themeDir, file, ...rest] = argv;
  const flags = parseFlags(rest);
  if (cmd !== 'import' || !themeDir || !file || !flags || flags.title === null) { process.stderr.write(USAGE); process.exit(64); }
  const m = importMedia(createWp(loadRuntime(themeDir)), file, { alt: flags.alt ?? undefined, title: flags.title });
  process.stdout.write(`${JSON.stringify({ ...m, attr: imageAttr(m) }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
