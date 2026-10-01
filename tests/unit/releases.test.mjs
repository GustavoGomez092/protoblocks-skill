import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pickRelease, fetchLatestRelease } from '../../skills/protoblocks-site-builder/scripts/lib/releases.mjs';
import { download, unzip } from '../../skills/protoblocks-site-builder/scripts/lib/download.mjs';

const rel = (tag, assets = [`x-${tag}.zip`], extra = {}) => ({
  tag_name: tag, draft: false, prerelease: false,
  assets: assets.map((n) => ({ name: n, browser_download_url: `https://dl/${tag}/${n}` })), ...extra,
});

test('pickRelease ignores the stale "latest" tag and picks the highest semver', () => {
  const list = [rel('latest', ['proto-blocks-2.10.0.zip']), rel('v2.9.1'), rel('v2.10.1'), rel('v2.10.0')];
  assert.deepEqual(pickRelease(list), { tag: 'v2.10.1', version: '2.10.1', zipUrl: 'https://dl/v2.10.1/x-v2.10.1.zip' });
});

test('pickRelease skips drafts, prereleases and releases without a zip', () => {
  const list = [rel('v3.0.0', [], {}), rel('v2.11.0', undefined, { draft: true }), rel('v2.10.5', undefined, { prerelease: true }), rel('v2.10.2')];
  assert.equal(pickRelease(list).tag, 'v2.10.2');
});

test('pickRelease returns null when nothing qualifies', () => {
  assert.equal(pickRelease([rel('latest')]), null);
});

test('fetchLatestRelease uses the releases list endpoint and errors clearly', async () => {
  let url;
  const ok = async (u) => { url = u; return { ok: true, json: async () => [rel('v1.1.3')] }; };
  const r = await fetchLatestRelease('o/n', { fetchImpl: ok });
  assert.equal(r.version, '1.1.3');
  assert.match(url, /\/repos\/o\/n\/releases\?per_page=30$/);
  const bad = async () => ({ ok: false, status: 403, statusText: 'rate limited', json: async () => ({}) });
  await assert.rejects(fetchLatestRelease('o/n', { fetchImpl: bad }), (e) => e.code === 'ERELEASE' && /403/.test(e.message));
});

test('unzip extracts and lists top-level entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-zip-'));
  fs.mkdirSync(path.join(dir, 'src/proto-theme'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/proto-theme/style.css'), '/* x */');
  execFileSync('zip', ['-qr', path.join(dir, 't.zip'), 'proto-theme'], { cwd: path.join(dir, 'src') });
  assert.deepEqual(unzip(path.join(dir, 't.zip'), path.join(dir, 'out')), ['proto-theme']);
  assert.ok(fs.existsSync(path.join(dir, 'out/proto-theme/style.css')));
});

test('fetchLatestRelease wraps fetch rejection as ERELEASE', async () => {
  const reject = async () => { throw new Error('network timeout'); };
  await assert.rejects(fetchLatestRelease('o/n', { fetchImpl: reject }), (e) => e.code === 'ERELEASE' && /network timeout/.test(e.message));
});

test('fetchLatestRelease wraps non-array body as ERELEASE', async () => {
  const badBody = async () => ({ ok: true, json: async () => ({ message: 'rate limited' }) });
  await assert.rejects(fetchLatestRelease('o/n', { fetchImpl: badBody }), (e) => e.code === 'ERELEASE');
});

test('download writes atomically and creates parent dirs on success', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dl-'));
  const dest = path.join(dir, 'deep/path/file.zip');
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('test').buffer });
  const result = await download('http://example.com/file.zip', dest, { fetchImpl });
  assert.equal(result, dest);
  assert.ok(fs.existsSync(dest));
  assert.equal(fs.readFileSync(dest, 'utf8'), 'test');
  fs.rmSync(dir, { recursive: true });
});

test('download gives EDOWNLOAD on fetch rejection, no file left behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dl-'));
  const dest = path.join(dir, 'file.zip');
  const fetchImpl = async () => { throw new Error('DNS failed'); };
  await assert.rejects(download('http://example.com/file.zip', dest, { fetchImpl }), (e) => e.code === 'EDOWNLOAD' && /DNS failed/.test(e.message));
  assert.ok(!fs.existsSync(dest));
  assert.ok(!fs.existsSync(dest + '.part'));
  fs.rmSync(dir, { recursive: true });
});

test('download gives EDOWNLOAD on non-OK response, no file left behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dl-'));
  const dest = path.join(dir, 'file.zip');
  const fetchImpl = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
  await assert.rejects(download('http://example.com/file.zip', dest, { fetchImpl }), (e) => e.code === 'EDOWNLOAD' && /404/.test(e.message));
  assert.ok(!fs.existsSync(dest));
  assert.ok(!fs.existsSync(dest + '.part'));
  fs.rmSync(dir, { recursive: true });
});

test('unzip refuses non-empty destination directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-zip-'));
  fs.mkdirSync(path.join(dir, 'src/proto-theme'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/proto-theme/style.css'), '/* x */');
  execFileSync('zip', ['-qr', path.join(dir, 't.zip'), 'proto-theme'], { cwd: path.join(dir, 'src') });
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'existing.txt'), 'content');
  assert.throws(() => unzip(path.join(dir, 't.zip'), out), (e) => e.code === 'EUNZIP' && /must be empty/.test(e.message));
  fs.rmSync(dir, { recursive: true });
});

test('unzip with corrupt zip gives EUNZIP', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-zip-'));
  const zipFile = path.join(dir, 'bad.zip');
  fs.writeFileSync(zipFile, 'not a zip file');
  const out = path.join(dir, 'out');
  assert.throws(() => unzip(zipFile, out), (e) => e.code === 'EUNZIP');
  fs.rmSync(dir, { recursive: true });
});
