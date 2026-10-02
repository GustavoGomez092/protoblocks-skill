import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupSite, parseArgs } from '../../skills/protoblocks-site-builder/scripts/lib/setup-site.mjs';
import { statePath, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'protoblocks-site-builder', 'scripts', 'lib', 'setup-site.mjs');

const okPreflight = (over = {}) => ({
  ok: true, mode: 'local-wrapper', wp: '/w/wp', url: 'http://x.local', publicPath: '/w/public',
  localSite: { id: 'abc', name: 'X', domain: 'x.local', rootPath: '/w' },
  checks: [{ id: 'site', status: 'pass', detail: 'ok' }, { id: 'yoast', status: 'warn', detail: 'w' }],
  ...over,
});

function harness({ preflight = okPreflight(), themeReused = false, forkThrows = null } = {}) {
  const themeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-setup-unit-'));
  const calls = [];
  const deps = {
    runPreflight: (o) => { calls.push(['preflight', o]); return preflight; },
    createWp: (rt) => { calls.push(['createWp', rt]); return { fake: true }; },
    ensurePlugins: async (wp) => { calls.push(['plugins', wp]); return { plugins: [], options: [] }; },
    fetchThemeZip: async () => { calls.push(['fetchZip']); return { zipFile: '/z.zip', forkedFrom: 'proto-blocks-theme@1.2.3', cleanup: () => calls.push(['cleanup']) }; },
    forkTheme: (o) => {
      calls.push(['fork', o]);
      if (forkThrows) throw forkThrows;
      return { themeDir, slug: 'acme', reused: themeReused, forkedFrom: o.forkedFrom ?? 'proto-blocks-theme@1.0.0' };
    },
    installThemeAssets: (d) => { calls.push(['assets', d]); return { copied: [], functionsUpdated: false }; },
  };
  return { themeDir, calls, deps };
}
const names = (calls) => calls.map((c) => c[0]);

test('EPREFLIGHT lists failing checks and never touches plugins, download or fork', async () => {
  const h = harness({ preflight: okPreflight({ ok: false, checks: [
    { id: 'wp-cli', status: 'fail', detail: 'WP-CLI failed', fix: 'Start the site' },
    { id: 'node', status: 'fail', detail: 'old' },
    { id: 'yoast', status: 'warn', detail: 'w' },
  ] }) });
  await assert.rejects(setupSite({ name: 'Acme' }, h.deps), (e) => {
    assert.equal(e.code, 'EPREFLIGHT');
    assert.match(e.message, /wp-cli: WP-CLI failed/);
    assert.match(e.message, /Start the site/);
    assert.match(e.message, /node: old/);
    assert.doesNotMatch(e.message, /yoast/);
    return true;
  });
  assert.deepEqual(names(h.calls), ['preflight']);
});

test('runs preflight, plugins, fork, assets in order and initializes state', async () => {
  const h = harness();
  const r = await setupSite({ cwd: '/c', site: 'X', name: 'Acme Co', slug: 'acme', force: false }, h.deps);
  assert.deepEqual(names(h.calls), ['preflight', 'createWp', 'plugins', 'fetchZip', 'fork', 'assets', 'cleanup']);
  assert.deepEqual(h.calls[0][1], { cwd: '/c', site: 'X' });
  const fork = h.calls.find((c) => c[0] === 'fork')[1];
  assert.equal(fork.name, 'Acme Co');
  assert.equal(fork.slug, 'acme');
  assert.equal(fork.force, false);
  assert.equal(fork.zipFile, '/z.zip');
  assert.equal(fork.forkedFrom, 'proto-blocks-theme@1.2.3');
  assert.equal(fork.themesDir, path.join('/w/public', 'wp-content', 'themes'));
  assert.deepEqual(fork.wp, { fake: true });
  assert.equal(r.stateFile, statePath(h.themeDir));
  assert.deepEqual(r.preflight, { mode: 'local-wrapper', url: 'http://x.local', checks: okPreflight().checks });
  const s = loadState(h.themeDir);
  assert.equal(s.site.url, 'http://x.local');
  assert.equal(s.site.path, '/w/public');
  assert.equal(s.site.localSiteId, 'abc');
  assert.deepEqual(s.site.wp, { mode: 'local-wrapper', wrapper: '/w/wp' });
  assert.deepEqual(s.site.theme, { slug: 'acme', forkedFrom: 'proto-blocks-theme@1.2.3' });
});

test('native mode records wp mode without wrapper or localSiteId', async () => {
  const h = harness({ preflight: okPreflight({ mode: 'native', localSite: null }) });
  await setupSite({ name: 'Acme' }, h.deps);
  const s = loadState(h.themeDir);
  assert.deepEqual(s.site.wp, { mode: 'native' });
  assert.equal('localSiteId' in s.site, false);
});

test('second run keeps existing state and only updates site.theme and site.url', async () => {
  const h = harness();
  await setupSite({ name: 'Acme' }, h.deps);
  const { updateState } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  updateState(h.themeDir, (s) => { s.library.hero = { purpose: 'x' }; });
  const h2 = harness({ preflight: okPreflight({ url: 'http://y.local' }), themeReused: true });
  h2.deps.forkTheme = (o) => ({ themeDir: h.themeDir, slug: 'acme', reused: true, forkedFrom: o.forkedFrom });
  const r = await setupSite({ name: 'Acme' }, h2.deps);
  assert.equal(r.theme.reused, true);
  const s = loadState(h.themeDir);
  assert.deepEqual(s.library.hero, { purpose: 'x' });
  assert.equal(s.site.url, 'http://y.local');
});

test('zip cleanup runs when forkTheme throws, and the error propagates', async () => {
  const boom = Object.assign(new Error('exists'), { code: 'EFORKEXISTS' });
  const h = harness({ forkThrows: boom });
  await assert.rejects(setupSite({ name: 'Acme' }, h.deps), (e) => e.code === 'EFORKEXISTS');
  assert.ok(names(h.calls).includes('cleanup'));
  assert.equal(names(h.calls).includes('assets'), false);
});

test('parseArgs: values, boolean --force, defaults', () => {
  assert.deepEqual(parseArgs(['--name', 'A B', '--slug', 's', '--site', 'Local X', '--cwd', '/d', '--force']),
    { name: 'A B', slug: 's', site: 'Local X', cwd: '/d', force: true, updatePlugins: false });
  assert.deepEqual(parseArgs(['--name', 'A']), { name: 'A', force: false, updatePlugins: false });
});

test('parseArgs rejects a missing value, an unknown flag and a stray positional (EUSAGE)', () => {
  for (const argv of [['--name'], ['--name', '--slug', 's'], ['--name', 'A', '--slug'], ['--name', 'A', '--bogus'], ['--name', 'A', 'stray'], ['--name', 'A', '--site', '--force']]) {
    assert.throws(() => parseArgs(argv), (e) => e.code === 'EUSAGE', JSON.stringify(argv));
  }
});

test('parseArgs requires --name', () => {
  assert.throws(() => parseArgs(['--force']), (e) => e.code === 'EUSAGE');
});

test('CLI exits 64 with usage for missing value, unknown flag and missing --name', () => {
  for (const argv of [['--name'], ['--name', 'A', '--bogus'], ['--name', 'A', '--slug'], []]) {
    const r = spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf8' });
    assert.equal(r.status, 64, JSON.stringify(argv));
    assert.match(r.stderr, /Usage: node setup-site\.mjs/);
  }
});

test('force: true is passed through to forkTheme', async () => {
  const h = harness();
  await setupSite({ name: 'Acme', force: true }, h.deps);
  assert.equal(h.calls.find((c) => c[0] === 'fork')[1].force, true);
});

test('--update-plugins is opt-in and reaches ensurePlugins', async () => {
  assert.equal(parseArgs(['--name', 'A']).updatePlugins, false);
  assert.equal(parseArgs(['--name', 'A', '--update-plugins']).updatePlugins, true);
  const h = harness();
  const seen = [];
  h.deps.ensurePlugins = async (_wp, opts) => { seen.push(opts); return { plugins: [], options: [] }; };
  await setupSite({ name: 'Acme' }, h.deps);
  await setupSite({ name: 'Acme', updatePlugins: true }, h.deps);
  assert.deepEqual(seen.map((o) => o?.updatePlugins), [false, true]);
});

// ---- I1: reuse skips the download; refork ----
function withFork(markerLine = 'Proto Fork: proto-blocks-theme@1.0.0') {
  const pub = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-setup-pub-'));
  const dir = path.join(pub, 'wp-content', 'themes', 'acme');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'style.css'), `/*\nTheme Name: Acme\n${markerLine}\n*/`);
  return okPreflight({ publicPath: pub });
}

test('a reusable fork skips fetchThemeZip entirely (offline re-runs work)', async () => {
  const h = harness({ preflight: withFork(), themeReused: true });
  h.deps.fetchThemeZip = async () => { throw Object.assign(new Error('offline'), { code: 'ERELEASE' }); };
  const r = await setupSite({ name: 'Acme' }, h.deps);
  assert.deepEqual(names(h.calls), ['preflight', 'createWp', 'plugins', 'fork', 'assets']);
  assert.equal(h.calls.find((c) => c[0] === 'fork')[1].zipFile, undefined);
  assert.equal(r.theme.reused, true);
});

test('force does not trigger a download for an existing fork either', async () => {
  const h = harness({ preflight: withFork(), themeReused: true });
  await setupSite({ name: 'Acme', force: true }, h.deps);
  assert.equal(names(h.calls).includes('fetchZip'), false);
});

test('refork downloads and passes refork through; a foreign folder still downloads', async () => {
  const h = harness({ preflight: withFork() });
  await setupSite({ name: 'Acme', refork: 'acme' }, h.deps);
  assert.ok(names(h.calls).includes('fetchZip'));
  assert.equal(h.calls.find((c) => c[0] === 'fork')[1].refork, 'acme');
  const f = harness({ preflight: withFork('Author: x') });
  await setupSite({ name: 'Acme', force: true }, f.deps);
  assert.ok(names(f.calls).includes('fetchZip'));
});

test('refork that does not equal the slug is ERFORK before plugins are touched', async () => {
  const h = harness({ preflight: withFork() });
  await assert.rejects(setupSite({ name: 'Acme', refork: 'other' }, h.deps), (e) => e.code === 'ERFORK');
  assert.deepEqual(names(h.calls), ['preflight']);
});

test('parseArgs accepts --refork <slug>', () => {
  assert.equal(parseArgs(['--name', 'A', '--refork', 'a']).refork, 'a');
  assert.throws(() => parseArgs(['--name', 'A', '--refork']), (e) => e.code === 'EUSAGE');
});
