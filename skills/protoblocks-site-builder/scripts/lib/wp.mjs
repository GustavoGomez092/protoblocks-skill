import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec as realExec } from './exec.mjs';
import { findWpRoot } from './preflight.mjs';
import { loadState, statePath } from './state.mjs';

export const WP_SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'wp');

export class WpError extends Error {
  constructor(args, result) {
    super(`wp ${args.join(' ')} failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim().slice(0, 2000)}`);
    this.code = 'EWP';
    this.args = args;
    this.result = result;
  }
}

// Local's WP-CLI has no `--` end-of-options handling: a positional such as `--exec=<php>` or
// `--require=<file>` would be parsed as a global flag and run PHP. eval-file positionals must be plain.
function assertPlainArgs(values) {
  for (const v of values) {
    if (typeof v !== 'string' || /^-/.test(v)) {
      const e = new Error(`Refusing eval-file argument ${JSON.stringify(v ?? null)}: arguments must be strings that do not start with "-" (pass data with evalFilePayload instead).`);
      e.code = 'EARGV';
      throw e;
    }
  }
}

// The optional second argument is an options object (`{ exec }`; later stages may add more keys).
export function createWp({ wp, mode, publicPath }, { exec = realExec } = {}) {
  const base = mode === 'native' ? [`--path=${publicPath}`] : [];
  // `run`/`check` take WP-CLI flags on purpose; only call them with arguments the caller controls.
  const run = (args, opts = {}) => exec(wp, [...base, ...args], opts);
  const check = (args, opts) => {
    const r = run(args, opts);
    if (r.code !== 0) throw new WpError(args, r);
    return r.stdout;
  };
  const evalFile = (file, args = []) => {
    assertPlainArgs([file, ...args]);
    const full = ['eval-file', file, ...args];
    const out = check(full);
    const last = out.trim().split('\n').filter(Boolean).at(-1) ?? '';
    try {
      return JSON.parse(last);
    } catch {
      throw new WpError(full, { code: 0, stdout: out, stderr: 'eval-file did not print JSON on its last line' });
    }
  };
  // Pass arbitrary data to a PHP script as a JSON file: `$args = [cmd, <payload.json>]`.
  const evalFilePayload = (file, cmd, data) => {
    assertPlainArgs([file, cmd]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-payload-'));
    const tmp = path.join(dir, 'payload.json');
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      return evalFile(file, [cmd, tmp]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  return { run, check, evalFile, evalFilePayload, wp, mode, publicPath };
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

const normUrl = (u) => String(u ?? '').trim().replace(/\/+$/, '');

/**
 * Build state records the site it was made for (`site.url`). Refuse (EWRONGSITE) to mutate state or the
 * theme when that differs from the site WP-CLI is talking to now: the state belongs to another site.
 */
export function assertStateSite(themeDir, { url }) {
  if (!fs.existsSync(statePath(themeDir))) return;
  const stateUrl = loadState(themeDir).site.url;
  if (normUrl(stateUrl) !== normUrl(url)) {
    const e = new Error(`The build state in ${statePath(themeDir)} belongs to ${stateUrl}, but this site is ${url}; refusing to change it. Use the theme of this site, or, if this site was renamed, fix the state first: node state.mjs set "${themeDir}" site.url '${JSON.stringify(url)}'`);
    e.code = 'EWRONGSITE';
    throw e;
  }
}

// loadRuntime for CLIs that write into a theme fork and its build state.
export function loadThemeRuntime(themeDir) {
  const rt = loadRuntime(themeDir);
  assertStateSite(themeDir, rt);
  return rt;
}
