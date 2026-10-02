#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createWp, loadRuntime } from './wp.mjs';

export const JSONLD_META_KEY = '_proto_jsonld';
const validType = (t) => (typeof t === 'string' && t !== '') || (Array.isArray(t) && t.length > 0 && t.every((x) => typeof x === 'string' && x !== ''));
const bad = (m) => { const e = new Error(m); e.code = 'EJSONLD'; return e; };

export function normalizeJsonld(value) {
  let nodes;
  if (Array.isArray(value)) nodes = value;
  else if (value && typeof value === 'object') nodes = Array.isArray(value['@graph']) ? value['@graph'] : [value];
  else throw bad('JSON-LD must be a node object, an array of nodes, or an object with @graph');
  return nodes.map((n, i) => {
    if (!n || typeof n !== 'object' || Array.isArray(n) || !validType(n['@type'])) throw bad(`JSON-LD node ${i} needs an object with a non-empty string or string-array @type`);
    const { '@context': _ctx, ...rest } = n;
    return rest;
  });
}

export function jsonldSupported(wp) {
  return wp.check(['eval', 'echo registered_meta_key_exists("post", "_proto_jsonld", "page") ? "1" : "0";']).trim() === '1';
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [cmd, themeDir] = process.argv.slice(2);
  if (cmd !== 'check' || !themeDir) { process.stderr.write('Usage: node jsonld.mjs check <themeDir>\n'); process.exit(64); }
  process.stdout.write(`${JSON.stringify({ supported: jsonldSupported(createWp(loadRuntime(themeDir))) })}\n`);
}
