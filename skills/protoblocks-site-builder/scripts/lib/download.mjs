import fs from 'node:fs';
import path from 'node:path';
import { exec as realExec } from './exec.mjs';

export async function download(url, dest, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': 'protoblocks-site-builder' }, redirect: 'follow', signal: AbortSignal.timeout(120000) });
  } catch (err) {
    const e = new Error(`Download failed ${url}: ${err.message}`);
    e.code = 'EDOWNLOAD';
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`Download failed ${url}: HTTP ${res.status}`);
    e.code = 'EDOWNLOAD';
    throw e;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tempDest = dest + '.part';
  fs.writeFileSync(tempDest, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tempDest, dest);
  return dest;
}

export function unzip(zipFile, destDir, { exec = realExec } = {}) {
  if (fs.existsSync(destDir)) {
    const entries = fs.readdirSync(destDir);
    if (entries.length > 0) {
      const e = new Error(`destination must be empty`);
      e.code = 'EUNZIP';
      throw e;
    }
  } else {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const r = exec('unzip', ['-q', '-o', zipFile, '-d', destDir]);
  if (r.code !== 0) {
    const e = new Error(`unzip ${zipFile} failed: ${r.stderr.trim()}`);
    e.code = 'EUNZIP';
    throw e;
  }
  return fs.readdirSync(destDir).filter((n) => !n.startsWith('__MACOSX') && !n.startsWith('.'));
}
