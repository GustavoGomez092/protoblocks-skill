#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 1;
export const DEFAULT_QA = Object.freeze({ mismatchMax: 0.08, heightDeltaMax: 0.03, maxIterations: 5, motionMaxAttempts: 3 });
export const SECTION_STATUS = ['planned', 'building', 'verifying', 'animating', 'done', 'skipped'];
export const PAGE_STATUS = ['planning', 'building', 'seo', 'done'];
const DECISIONS = ['new', 'reuse', 'extend'];

export class StateError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const str = { type: 'string' };
const obj = { type: 'object' };
const arr = { type: 'array' };

export const schema = {
  type: 'object',
  required: ['schemaVersion', 'site', 'library', 'pages'],
  properties: {
    schemaVersion: { type: 'integer', enum: [SCHEMA_VERSION] },
    site: {
      type: 'object',
      required: ['url', 'path'],
      properties: {
        localSiteId: str, path: str, url: str,
        wp: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['local-wrapper', 'native'] }, wrapper: str } },
        theme: { type: 'object', properties: { slug: str, forkedFrom: str } },
        tokens: obj, motionProfile: obj, navigation: obj, parts: obj,
        qa: { type: 'object', properties: { mismatchMax: { type: 'number' }, heightDeltaMax: { type: 'number' }, maxIterations: { type: 'integer' }, motionMaxAttempts: { type: 'integer' } } },
      },
    },
    library: {
      type: 'object',
      additionalProperties: { type: 'object', properties: { purpose: str, usedOn: { type: 'array', items: str }, variants: { type: 'array', items: str } } },
    },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'status', 'sections'],
        properties: {
          slug: str, title: str,
          postId: { type: ['integer', 'null'] },
          status: { type: 'string', enum: PAGE_STATUS },
          contentHash: { type: ['string', 'null'] },
          design: obj, seo: obj,
          sections: {
            type: 'array',
            items: {
              type: 'object',
              required: ['n', 'anchor', 'status'],
              properties: {
                n: { type: 'integer' }, anchor: str, label: str, block: str,
                decision: { type: 'string', enum: DECISIONS },
                attrs: obj, inner: arr, crops: obj, qa: arr, motion: obj,
                status: { type: 'string', enum: SECTION_STATUS },
              },
            },
          },
        },
      },
    },
  },
};

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(v, t) {
  const actual = typeOf(v);
  return [].concat(t).some((x) => x === actual || (x === 'number' && actual === 'integer'));
}

function check(value, s, at, errors) {
  if (s.type && !matchesType(value, s.type)) {
    errors.push(`${at}: expected ${[].concat(s.type).join('|')}, got ${typeOf(value)}`);
    return;
  }
  if (s.enum && !s.enum.includes(value)) {
    errors.push(`${at}: must be one of ${s.enum.join(', ')} (got ${JSON.stringify(value)})`);
  }
  if (typeOf(value) === 'object') {
    for (const k of s.required ?? []) if (!(k in value)) errors.push(`${at}.${k}: required`);
    for (const [k, v] of Object.entries(value)) {
      const sub = s.properties?.[k] ?? s.additionalProperties;
      if (sub && typeof sub === 'object') check(v, sub, `${at}.${k}`, errors);
    }
  }
  if (typeOf(value) === 'array' && s.items) {
    for (let i = 0; i < value.length; i++) check(value[i], s.items, `${at}[${i}]`, errors);
  }
}

export function validate(value) {
  const errors = [];
  check(value, schema, '$', errors);
  return errors;
}

export const stateDir = (themeDir) => path.join(themeDir, '.protoblocks');
export const statePath = (themeDir) => path.join(stateDir(themeDir), 'build.json');

function assertValid(state) {
  const errors = validate(state);
  if (errors.length) throw new StateError(`State invalid:\n- ${errors.join('\n- ')}`, 'EINVALID');
}

function parseFile(file, hint) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new StateError(`State file ${file} is not valid JSON (${e.message}). ${hint}`, 'EPARSE');
  }
}

export function loadState(themeDir) {
  const file = statePath(themeDir);
  if (!fs.existsSync(file)) throw new StateError(`No state file at ${file}. Run: node state.mjs init <themeDir> <site.json>`, 'ENOSTATE');
  const data = parseFile(file, `Recover the last good copy with: node state.mjs restore ${themeDir}`);
  assertValid(data);
  return data;
}

export function saveState(themeDir, state) {
  assertValid(state);
  const file = statePath(themeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try {
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      // only copy to .bak if current file is valid JSON AND passes validation
      if (validate(current).length === 0) {
        fs.copyFileSync(file, `${file}.bak`);
      }
    } catch (e) {
      // current file is corrupt or doesn't parse, don't overwrite .bak
    }
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function restoreState(themeDir) {
  const file = statePath(themeDir);
  const bak = `${file}.bak`;
  if (!fs.existsSync(bak)) throw new StateError(`No backup at ${bak}`, 'ENOBACKUP');
  const data = parseFile(bak, 'The backup is also corrupt; inspect it by hand.');
  assertValid(data);
  fs.copyFileSync(bak, file);
  return data;
}

export function initState(themeDir, site) {
  if (fs.existsSync(statePath(themeDir))) throw new StateError(`State already exists at ${statePath(themeDir)}`, 'EEXISTS');
  const state = { schemaVersion: SCHEMA_VERSION, site: { ...site, qa: { ...DEFAULT_QA, ...(site.qa ?? {}) } }, library: {}, pages: [] };
  saveState(themeDir, state);
  fs.writeFileSync(path.join(stateDir(themeDir), '.gitignore'), 'artifacts/\nbuild.json.bak\nbuild.json.lock\nbuild.json.tmp-*\n');
  return state;
}

function waitForLock(lockPath, endTime) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  while (true) {
    try {
      return fs.openSync(lockPath, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const now = Date.now();
      if (now > endTime) throw new StateError(`Lock timeout on ${lockPath}`, 'ELOCKED');
      try {
        const stat = fs.statSync(lockPath);
        const lockAge = now - stat.mtimeMs;
        if (lockAge > 30000) {
          try {
            fs.unlinkSync(lockPath);
            // Race: another waiter may also unlink; acceptable (stale lock cleanup).
          } catch (e2) {
            if (e2.code !== 'ENOENT') throw e2;
            // Lock was already removed, retry immediately.
          }
        } else {
          // Sleep 50ms before retry
          Atomics.wait(ia, 0, 0, 50);
        }
      } catch (e2) {
        if (e2.code !== 'ENOENT') throw e2;
        // Lock holder released between check and stat; retry immediately.
      }
    }
  }
}

export function updateState(themeDir, fn, opts = {}) {
  const { timeoutMs = 10000 } = opts;
  // Check state exists before acquiring lock to throw ENOSTATE early
  const file = statePath(themeDir);
  if (!fs.existsSync(file)) throw new StateError(`No state file at ${file}. Run: node state.mjs init <themeDir> <site.json>`, 'ENOSTATE');

  const lockPath = path.join(stateDir(themeDir), 'build.json.lock');
  const endTime = Date.now() + timeoutMs;
  let lockFd;
  try {
    lockFd = waitForLock(lockPath, endTime);
    const state = loadState(themeDir);
    const next = fn(state) ?? state;
    saveState(themeDir, next);
    return next;
  } finally {
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      try {
        fs.unlinkSync(lockPath);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
}

const segs = (dotted) => (dotted === '' ? [] : dotted.split('.'));
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function guardSegs(parts) {
  for (const s of parts) if (FORBIDDEN.has(s)) throw new StateError(`Path segment "${s}" is not allowed`, 'EINVALID');
}

// Resolve a segment against a container for reading (lenient).
const key = (container, s) => (Array.isArray(container) && /^\d+$/.test(s) ? Number(s) : s);

// Resolve a segment for writing: arrays only accept an index <= length.
function writeKey(container, s, dotted) {
  if (!Array.isArray(container)) return s;
  if (!/^\d+$/.test(s)) throw new StateError(`Cannot use "${s}" as a key on an array in "${dotted}"; use a numeric index`, 'EINVALID');
  const i = Number(s);
  if (i > container.length) throw new StateError(`Index ${i} is past the end of the array (length ${container.length}) in "${dotted}"; use append or index ${container.length}`, 'EINVALID');
  return i;
}

export function getPath(o, dotted) {
  let cur = o;
  for (const s of segs(dotted)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = Object.hasOwn(cur, key(cur, s)) ? cur[key(cur, s)] : undefined;
  }
  return cur;
}

export function setPath(o, dotted, value) {
  const parts = segs(dotted);
  if (!parts.length) throw new StateError('setPath needs a non-empty path', 'EINVALID');
  guardSegs(parts);
  let cur = o;
  for (const s of parts.slice(0, -1)) {
    const k = writeKey(cur, s, dotted);
    if (cur[k] === undefined || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[writeKey(cur, parts.at(-1), dotted)] = value;
  return o;
}

export function appendPath(o, dotted, value) {
  guardSegs(segs(dotted));
  const existing = getPath(o, dotted);
  if (existing === undefined) return setPath(o, dotted, [value]);
  if (!Array.isArray(existing)) throw new StateError(`${dotted} is not an array`, 'EINVALID');
  existing.push(value);
  return o;
}

const USAGE = 'Usage: node state.mjs <init|get|set|append|validate|restore> <themeDir> [path] [json]\n';

function parseValue(json) {
  try { return JSON.parse(json); } catch (e) {
    throw new StateError(`Value is not valid JSON: ${e.message}`, 'EVALUE');
  }
}

function main(argv) {
  const [cmd, themeDir, p, json] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v === undefined ? null : v, null, 2)}\n`);
  if (!cmd || !themeDir) {
    process.stderr.write('Usage: node state.mjs <init|get|set|append|validate|restore> <themeDir> [path] [json]\n');
    process.exit(64);
  }
  switch (cmd) {
    case 'init': {
      if (!p) {
        process.stderr.write('Usage: node state.mjs <init|get|set|append|validate|restore> <themeDir> [path] [json]\n');
        process.exit(64);
      }
      return out(initState(themeDir, JSON.parse(fs.readFileSync(p, 'utf8'))));
    }
    case 'get': return out(getPath(loadState(themeDir), p ?? ''));
    case 'set': {
      if (!p || !json) {
        process.stderr.write('Usage: node state.mjs <init|get|set|append|validate|restore> <themeDir> [path] [json]\n');
        process.exit(64);
      }
      const value = parseValue(json);
      return out(getPath(updateState(themeDir, (s) => { setPath(s, p, value); }), p));
    }
    case 'append': {
      if (!p || !json) {
        process.stderr.write('Usage: node state.mjs <init|get|set|append|validate|restore> <themeDir> [path] [json]\n');
        process.exit(64);
      }
      const value = parseValue(json);
      return out(getPath(updateState(themeDir, (s) => { appendPath(s, p, value); }), p));
    }
    case 'validate': loadState(themeDir); return out({ valid: true });
    case 'restore': return out(restoreState(themeDir));
    default:
      process.stderr.write(`Unknown command: ${cmd}\n`);
      process.exit(64);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`);
    process.exit(1);
  }
}
