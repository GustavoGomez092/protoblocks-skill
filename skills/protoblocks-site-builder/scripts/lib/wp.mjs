import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec as realExec } from './exec.mjs';
import { findWpRoot } from './preflight.mjs';

export const WP_SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'wp');

export class WpError extends Error {
  constructor(args, result) {
    super(`wp ${args.join(' ')} failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim().slice(0, 2000)}`);
    this.code = 'EWP';
    this.args = args;
    this.result = result;
  }
}

export function createWp({ wp, mode, publicPath }, { exec = realExec } = {}) {
  const base = mode === 'native' ? [`--path=${publicPath}`] : [];
  const run = (args, opts = {}) => exec(wp, [...base, ...args], opts);
  const check = (args, opts) => {
    const r = run(args, opts);
    if (r.code !== 0) throw new WpError(args, r);
    return r.stdout;
  };
  const evalFile = (file, args = []) => {
    const full = ['eval-file', file, ...args];
    const out = check(full);
    const last = out.trim().split('\n').filter(Boolean).at(-1) ?? '';
    try {
      return JSON.parse(last);
    } catch {
      throw new WpError(full, { code: 0, stdout: out, stderr: 'eval-file did not print JSON on its last line' });
    }
  };
  return { run, check, evalFile, wp, mode, publicPath };
}

export function loadRuntime(dir) {
  const root = findWpRoot(dir);
  const file = root && path.join(root, 'wp-content', '.protoblocks', 'preflight.json');
  if (!file || !fs.existsSync(file)) {
    const e = new Error('Run preflight first: node preflight.mjs');
    e.code = 'ENORUNTIME';
    throw e;
  }
  let r;
  try {
    r = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const e = new Error('preflight.json unreadable; re-run preflight');
    e.code = 'ENORUNTIME';
    throw e;
  }
  if (r.ok !== true || !r.wp) {
    const e = new Error('The last preflight failed; fix its checks and re-run: node preflight.mjs');
    e.code = 'ENORUNTIME';
    throw e;
  }
  return { wp: r.wp, mode: r.mode, publicPath: r.publicPath, url: r.url, localSite: r.localSite ?? null };
}
