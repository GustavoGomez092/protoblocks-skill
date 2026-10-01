import fs from 'node:fs';
import path from 'node:path';
import { exec as realExec } from './exec.mjs';

export async function download(url, dest, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'protoblocks-site-builder' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed ${url}: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

export function unzip(zipFile, destDir, { exec = realExec } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = exec('unzip', ['-q', '-o', zipFile, '-d', destDir]);
  if (r.code !== 0) {
    const e = new Error(`unzip ${zipFile} failed: ${r.stderr.trim()}`);
    e.code = 'EUNZIP';
    throw e;
  }
  return fs.readdirSync(destDir).filter((n) => !n.startsWith('__MACOSX') && !n.startsWith('.'));
}
