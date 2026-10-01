import { spawnSync } from 'node:child_process';

/**
 * Run a command synchronously. Never throws.
 * @returns {{code:number, stdout:string, stderr:string}}
 */
export function exec(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    timeout: opts.timeout ?? 120000,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    return { code: r.error.code === 'ENOENT' ? 127 : 1, stdout: '', stderr: String(r.error.message) };
  }
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
