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

const REPO = path.resolve(HERE, '../..');
const VENDOR_DIR = path.join(REPO, 'node_modules', 'gsap', 'dist');
const RUNTIME_FILE = path.join(REPO, 'skills', 'protoblocks-site-builder', 'scripts', 'theme-assets', 'assets', 'js', 'pb-motion.js');
const within = (p, dir) => p === dir || p.startsWith(dir + path.sep);
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.ttf': 'font/ttf' };

function resolveFixture(root, pathname) {
  if (pathname === '/runtime/pb-motion.js') return RUNTIME_FILE;
  if (pathname.startsWith('/vendor/')) {
    const p = path.join(VENDOR_DIR, pathname.slice('/vendor/'.length));
    return within(p, VENDOR_DIR) ? p : null;
  }
  const p = path.join(root, pathname);
  return within(p, root) ? p : null;
}

// `virtual` maps a URL path to { body, type } served instead of a file (tests that generate a script from docs).
export function serveFixtures(virtual = {}) {
  const root = path.join(HERE, 'fixtures');
  const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://x').pathname === '/__hang') return; // never responds (stalled request)
    // /__slow/<ms>/<fixture path>: the fixture file, answered after <ms> (a slow web font or image).
    const slow = new URL(req.url, 'http://x').pathname.match(/^\/__slow\/(\d+)(\/.*)$/);
    if (slow) { setTimeout(() => serveFile(slow[2]), Number(slow[1])); return; }
    const v = virtual[new URL(req.url, 'http://x').pathname];
    if (v) { res.writeHead(200, { 'Content-Type': v.type }); res.end(v.body); return; }
    serveFile(new URL(req.url, 'http://x').pathname);
    function serveFile(raw) {
      let pathname;
      try { pathname = decodeURIComponent(raw); } catch { pathname = null; }
      const p = pathname && resolveFixture(root, pathname);
      if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) });
  }));
}
