import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const QA_DIR = path.resolve(HERE, '../../skills/protoblocks-site-builder/scripts/qa');
export const haveQaDeps = fs.existsSync(path.join(QA_DIR, 'node_modules', 'playwright')) && fs.existsSync(path.join(QA_DIR, 'node_modules', 'sharp'));
export const qtest = (name, optsOrFn, maybeFn) => {
  const [opts, fn] = typeof optsOrFn === 'function' ? [{}, optsOrFn] : [optsOrFn, maybeFn];
  return haveQaDeps ? test(name, opts, fn) : test.skip(`${name} (run npm install in scripts/qa first)`, opts, fn);
};
// Every directory made here is removed when the importing test file finishes.
const madeDirs = [];
after(() => { for (const d of madeDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
export const tmpDir = (prefix = 'pb-qa-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); madeDirs.push(d); return d; };

export async function makeImage({ width, height, bg = [255, 255, 255], rects = [] }, file) {
  const sharp = createRequire(path.join(QA_DIR, 'package.json'))('sharp');
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...bg, 255], i * 4);
  for (const r of rects) {
    for (let y = r.y; y < Math.min(height, r.y + r.h); y++) {
      for (let x = r.x; x < Math.min(width, r.x + r.w); x++) data.set([...r.color, 255], (y * width + x) * 4);
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(file);
  return file;
}

export function serveFixtures() {
  const root = path.join(HERE, 'fixtures');
  const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://x').pathname === '/__hang') return; // never responds (stalled request)
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!(p === root || p.startsWith(root + path.sep)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    const type = p.endsWith('.html') ? 'text/html' : p.endsWith('.png') ? 'image/png' : p.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) });
  }));
}
