#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime } from './wp.mjs';
import { loadState, updateState, statePath } from './state.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const USAGE = 'Usage: node library.mjs list <themeDir> | record <themeDir> <block> <page> [--purpose T] [--variants a,b]\n';

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const assertBlock = (block) => {
  if (typeof block !== 'string' || !SLUG.test(block)) throw fail('EBLOCK', `Invalid block slug ${JSON.stringify(block)}; use lowercase letters, digits and dashes`);
};
const assertPage = (page) => {
  if (typeof page !== 'string' || !SLUG.test(page)) throw fail('ESLUG', `Invalid page slug ${JSON.stringify(page)}; use lowercase letters, digits and dashes`);
};
const assertVariants = (variants) => {
  if (!Array.isArray(variants) || !variants.every((v) => typeof v === 'string' && TOKEN.test(v))) {
    throw fail('EVARIANT', `variants must be a list of tokens (letters, digits, _ or -); got ${JSON.stringify(variants)}`);
  }
};

export function readBlockJson(themeDir, block) {
  assertBlock(block);
  const root = path.join(themeDir, 'proto-blocks');
  const file = path.join(root, block, 'block.json');
  if (!fs.existsSync(file)) return null;
  const rootReal = fs.realpathSync(root);
  const fileReal = fs.realpathSync(file);
  if (!fileReal.startsWith(rootReal + path.sep)) throw fail('EBLOCK', `Block "${block}" resolves outside ${root}; refusing to read ${file}`);
  try {
    return JSON.parse(fs.readFileSync(fileReal, 'utf8'));
  } catch (e) {
    throw fail('EBLOCKJSON', `Invalid JSON in ${file}: ${e.message}`);
  }
}

const INNER = new Set(['inner-blocks', 'innerblocks']);

export function summarizeBlock(json) {
  const pb = json.protoBlocks ?? {};
  const fields = Object.fromEntries(Object.entries(pb.fields ?? {}).map(([k, v]) => [k, v.type]));
  const controls = Object.fromEntries(Object.entries(pb.controls ?? {}).map(([k, v]) => [
    k, ['select', 'radio', 'multiselect'].includes(v.type) && Array.isArray(v.options) ? `${v.type}(${v.options.map((o) => o.key ?? o.value).join('|')})` : v.type,
  ]));
  return { name: json.name, title: json.title, description: json.description ?? '', fields, controls, useTailwind: !!pb.useTailwind, innerBlocks: Object.values(fields).some((t) => INNER.has(t)) };
}

function registeredSlugs(wp) {
  let out;
  try {
    out = wp.check(['proto-blocks', 'list', '--format=json']).trim();
  } catch (e) {
    throw fail('ENOPROTOBLOCKS', `Could not run "wp proto-blocks list" (is the Proto-Blocks plugin active?): ${e.message}`);
  }
  if (!out) return []; // plugin active but nothing registered (WP-CLI only warns on stderr)
  for (const candidate of [out, ...out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('[')).reverse()]) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed.map((r) => String(r?.name ?? '').replace(/^proto-blocks\//, ''));
    } catch { /* try the next candidate */ }
  }
  throw fail('ENOPROTOBLOCKS', `"wp proto-blocks list --format=json" did not return a JSON list: ${out.slice(0, 200)}`);
}

export function listLibrary(wp, themeDir) {
  const registered = registeredSlugs(wp);
  const lib = fs.existsSync(statePath(themeDir)) ? loadState(themeDir).library : {};
  const own = (slug) => (Object.hasOwn(lib, slug) ? lib[slug] : undefined);
  return [...new Set(registered)]
    .filter((slug) => SLUG.test(slug))
    .filter((slug) => fs.existsSync(path.join(themeDir, 'proto-blocks', slug, 'block.json')))
    .sort()
    .map((slug) => ({ slug, ...summarizeBlock(readBlockJson(themeDir, slug)), purpose: own(slug)?.purpose ?? '', variants: own(slug)?.variants ?? [], usedOn: own(slug)?.usedOn ?? [], baselines: own(slug)?.baselines ?? [] }));
}

export function recordUse(themeDir, block, pageSlug, { purpose, variants } = {}) {
  assertBlock(block);
  assertPage(pageSlug);
  if (variants !== undefined) assertVariants(variants);
  let entry;
  updateState(themeDir, (s) => {
    if (!Object.hasOwn(s.library, block)) s.library[block] = { usedOn: [] };
    entry = s.library[block];
    entry.usedOn ??= [];
    if (!entry.usedOn.includes(pageSlug)) entry.usedOn.push(pageSlug);
    if (purpose) entry.purpose = purpose;
    if (variants) entry.variants = variants;
  });
  return entry;
}

class UsageError extends Error {}

function parseFlags(rest, allowed) {
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i];
    if (!name.startsWith('--') || !allowed.includes(name.slice(2))) throw new UsageError(`Unknown flag ${name}`);
    if (rest[i + 1] === undefined) throw new UsageError(`Flag ${name} needs a value`);
    flags[name.slice(2)] = rest[i + 1];
  }
  return flags;
}

function main(argv) {
  const [cmd, themeDir, block, page, ...rest] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'list' && themeDir && block === undefined) return out(listLibrary(createWp(loadRuntime(themeDir)), themeDir));
  if (cmd === 'record' && themeDir && block && page) {
    const flags = parseFlags(rest, ['purpose', 'variants']);
    return out(recordUse(themeDir, block, page, { purpose: flags.purpose, variants: flags.variants?.split(',') }));
  }
  throw new UsageError('Bad arguments');
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`${e.message}\n${USAGE}`);
      process.exit(64);
    }
    process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`);
    process.exit(1);
  }
}
