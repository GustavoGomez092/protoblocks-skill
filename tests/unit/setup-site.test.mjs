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
// site.theme minus the README hash every run records (checked here, compared elsewhere).
const noHash = ({ readmeHash, ...theme }) => { assert.match(readmeHash ?? '', /^[0-9a-f]{64}$/); return theme; };

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
  assert.deepEqual(noHash(s.site.theme), { slug: 'acme', forkedFrom: 'proto-blocks-theme@1.2.3' });
});

test('native mode records wp mode without wrapper or localSiteId', async () => {
  const h = harness({ preflight: okPreflight({ mode: 'native', localSite: null }) });
  await setupSite({ name: 'Acme' }, h.deps);
  const s = loadState(h.themeDir);
  assert.deepEqual(s.site.wp, { mode: 'native' });
  assert.equal('localSiteId' in s.site, false);
});

test('second run on the same site keeps existing state and updates site.theme', async () => {
  const h = harness();
  await setupSite({ name: 'Acme' }, h.deps);
  const { updateState } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  updateState(h.themeDir, (s) => { s.library.hero = { purpose: 'x' }; });
  const h2 = harness({ themeReused: true });
  h2.deps.forkTheme = (o) => ({ themeDir: h.themeDir, slug: 'acme', reused: true, forkedFrom: 'proto-blocks-theme@9.9.9' });
  const r = await setupSite({ name: 'Acme' }, h2.deps);
  assert.equal(r.theme.reused, true);
  const s = loadState(h.themeDir);
  assert.deepEqual(s.library.hero, { purpose: 'x' });
  assert.equal(s.site.url, 'http://x.local');
  assert.deepEqual(noHash(s.site.theme), { slug: 'acme', forkedFrom: 'proto-blocks-theme@9.9.9' });
});

test('zip cleanup runs when forkTheme throws, and the error propagates', async () => {
  const boom = Object.assign(new Error('exists'), { code: 'EFORKEXISTS' });
  const h = harness({ forkThrows: boom });
  await assert.rejects(setupSite({ name: 'Acme' }, h.deps), (e) => e.code === 'EFORKEXISTS');
  assert.ok(names(h.calls).includes('cleanup'));
  assert.equal(names(h.calls).includes('assets'), false);
});

test('--theme-name and --category-title reach forkTheme and are recorded as site.theme.displayName / category', async () => {
  assert.deepEqual(parseArgs(['--name', 'O-Flex', '--theme-name', 'O-Flex Group', '--category-title', 'O-Flex blocks']),
    { name: 'O-Flex', themeName: 'O-Flex Group', categoryTitle: 'O-Flex blocks', force: false, updatePlugins: false, readme: false });
  for (const argv of [['--name', 'A', '--theme-name'], ['--name', 'A', '--category-title', '--force']]) {
    assert.throws(() => parseArgs(argv), (e) => e.code === 'EUSAGE', JSON.stringify(argv));
  }
  const h = harness();
  h.deps.forkTheme = (o) => { h.calls.push(['fork', o]); return { themeDir: h.themeDir, slug: 'o-flex', reused: false, forkedFrom: 'proto-blocks-theme@1.4.0', displayName: o.themeName, category: { slug: 'o-flex', title: o.categoryTitle ?? `${o.themeName} blocks` } }; };
  await setupSite({ name: 'O-Flex', themeName: 'O-Flex Group' }, h.deps);
  const fork = h.calls.find((c) => c[0] === 'fork')[1];
  assert.equal(fork.themeName, 'O-Flex Group');
  assert.equal('categoryTitle' in fork, false, 'not passed when not given (the fork decides the default)');
  assert.deepEqual(noHash(loadState(h.themeDir).site.theme), { slug: 'o-flex', forkedFrom: 'proto-blocks-theme@1.4.0', displayName: 'O-Flex Group', category: { slug: 'o-flex', title: 'O-Flex Group blocks' } });
  // Without the flags nothing identity-related is passed to forkTheme.
  const plain = harness();
  await setupSite({ name: 'Acme' }, plain.deps);
  const pf = plain.calls.find((c) => c[0] === 'fork')[1];
  assert.equal('themeName' in pf, false);
  assert.equal('categoryTitle' in pf, false);
  assert.deepEqual(noHash(loadState(plain.themeDir).site.theme), { slug: 'acme', forkedFrom: 'proto-blocks-theme@1.2.3' }, 'a fake fork without identity records none');
});

test('a re-run keeps site.theme.screenshot while refreshing the rest of site.theme', async () => {
  const h = harness();
  await setupSite({ name: 'Acme' }, h.deps);
  const { updateState } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  updateState(h.themeDir, (s) => { s.site.theme.screenshot = { page: 'home', source: 'frame', writtenAt: 'x' }; });
  const h2 = harness();
  h2.deps.forkTheme = () => ({ themeDir: h.themeDir, slug: 'acme', reused: true, renamed: true, forkedFrom: 'proto-blocks-theme@1.2.3', displayName: 'Acme Group', category: { slug: 'acme', title: 'Acme Group blocks' } });
  await setupSite({ name: 'Acme', themeName: 'Acme Group' }, h2.deps);
  assert.deepEqual(noHash(loadState(h.themeDir).site.theme), { slug: 'acme', forkedFrom: 'proto-blocks-theme@1.2.3', displayName: 'Acme Group', category: { slug: 'acme', title: 'Acme Group blocks' }, screenshot: { page: 'home', source: 'frame', writtenAt: 'x' } });
});

test('parseArgs: values, boolean --force, defaults', () => {
  assert.deepEqual(parseArgs(['--name', 'A B', '--slug', 's', '--site', 'Local X', '--cwd', '/d', '--force']),
    { name: 'A B', slug: 's', site: 'Local X', cwd: '/d', force: true, updatePlugins: false, readme: false });
  assert.deepEqual(parseArgs(['--name', 'A']), { name: 'A', force: false, updatePlugins: false, readme: false });
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

// ---- M5: build state that belongs to another site ----
test('setupSite refuses with EWRONGSITE before touching plugins when the fork state is for another url', async () => {
  const pre = withFork();
  const { initState: init } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  init(path.join(pre.publicPath, 'wp-content', 'themes', 'acme'), { url: 'http://other.local', path: '/elsewhere' });
  const h = harness({ preflight: pre });
  await assert.rejects(setupSite({ name: 'Acme' }, h.deps), (e) => e.code === 'EWRONGSITE' && /other\.local/.test(e.message));
  assert.deepEqual(names(h.calls), ['preflight']);
});

test('setupSite refuses with EWRONGSITE when the forked theme dir state is for another url', async () => {
  const h = harness();
  await setupSite({ name: 'Acme' }, h.deps);
  const h2 = harness({ preflight: okPreflight({ url: 'http://y.local' }) });
  h2.deps.forkTheme = () => ({ themeDir: h.themeDir, slug: 'acme', reused: true, forkedFrom: 'proto-blocks-theme@1.0.0' });
  const before = fs.readFileSync(statePath(h.themeDir), 'utf8');
  await assert.rejects(setupSite({ name: 'Acme' }, h2.deps), (e) => e.code === 'EWRONGSITE');
  assert.equal(fs.readFileSync(statePath(h.themeDir), 'utf8'), before);
});

test('a re-run on the same site refreshes site.path and site.wp along with the theme', async () => {
  const h = harness();
  await setupSite({ name: 'Acme' }, h.deps);
  const h2 = harness({ preflight: okPreflight({ publicPath: '/moved/public', wp: '/moved/wp' }) });
  h2.deps.forkTheme = () => ({ themeDir: h.themeDir, slug: 'acme', reused: true, forkedFrom: 'proto-blocks-theme@1.2.3' });
  await setupSite({ name: 'Acme' }, h2.deps);
  const s = loadState(h.themeDir);
  assert.equal(s.site.path, '/moved/public');
  assert.deepEqual(s.site.wp, { mode: 'local-wrapper', wrapper: '/moved/wp' });
});

// ---- the fork's README and logo ----
import { cleanSvg, installLogo, readmeContent, writeReadme } from '../../skills/protoblocks-site-builder/scripts/lib/setup-site.mjs';

const SVG = '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Figma -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg id="Layer_1" x="0px" y="0px" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" xml:space="preserve"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h10v10z"/></svg>\n';
const README_PLAIN = '# Acme Co\n\nWordPress block theme for Acme Co, powered by [Proto-Blocks](https://github.com/GustavoGomez092/Proto-Blocks).\n';
const logoFile = (dir, name, body = SVG) => { const f = path.join(dir, name); fs.writeFileSync(f, body); return f; };

test('cleanSvg strips the prolog, doctype, comments and the root id/x/y/version/xml:space, keeping inner ids and the rest', () => {
  assert.equal(cleanSvg(SVG), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h10v10z"/></svg>\n');
  assert.equal(cleanSvg('<svg viewBox="0 0 1 1"/>'), '<svg viewBox="0 0 1 1"/>\n');
});

test('readmeContent: the display name, the project line, and the logo block only with a logo (alt escaped)', () => {
  assert.equal(readmeContent({ displayName: 'Acme Co', projectName: 'Acme Co' }), README_PLAIN);
  assert.equal(readmeContent({ displayName: 'A "&" B', projectName: 'Acme', logo: 'assets/img/logo.svg' }), '<p align="center">\n  <img src="assets/img/logo.svg" alt="A &quot;&amp;&quot; B" width="360">\n</p>\n\n# A "&" B\n\nWordPress block theme for Acme, powered by [Proto-Blocks](https://github.com/GustavoGomez092/Proto-Blocks).\n');
});

test('a fresh fork gets the client README (inherited README replaced) and site.theme.readmeHash', async () => {
  const h = harness();
  fs.writeFileSync(path.join(h.themeDir, 'README.md'), '# proto-blocks-theme\n');
  const r = await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme' }, h.deps);
  assert.equal(fs.readFileSync(path.join(h.themeDir, 'README.md'), 'utf8'), README_PLAIN);
  assert.equal(r.readme.file, path.join(h.themeDir, 'README.md'));
  assert.equal(r.logo, undefined);
  const theme = loadState(h.themeDir).site.theme;
  assert.equal(theme.readmeHash, r.readme.hash);
  assert.match(theme.readmeHash, /^[0-9a-f]{64}$/);
  assert.equal(theme.logo, undefined);
});

test('--logo copies the cleaned SVG to assets/img/logo.svg, records site.theme.logo and puts it in the README; png is kept as is', async () => {
  const h = harness();
  const r = await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme', logo: logoFile(h.themeDir, 'brand.SVG') }, h.deps);
  assert.equal(r.logo, 'assets/img/logo.svg');
  assert.equal(fs.readFileSync(path.join(h.themeDir, 'assets', 'img', 'logo.svg'), 'utf8'), cleanSvg(SVG));
  const readme = fs.readFileSync(path.join(h.themeDir, 'README.md'), 'utf8');
  assert.ok(readme.startsWith('<p align="center">\n  <img src="assets/img/logo.svg" alt="Acme Co" width="360">\n</p>\n\n# Acme Co\n'), readme);
  assert.equal(loadState(h.themeDir).site.theme.logo, 'assets/img/logo.svg');
  const p = harness();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme', logo: logoFile(p.themeDir, 'logo.png', png) }, p.deps);
  assert.deepEqual(fs.readFileSync(path.join(p.themeDir, 'assets', 'img', 'logo.png')), png);
  assert.match(fs.readFileSync(path.join(p.themeDir, 'README.md'), 'utf8'), /src="assets\/img\/logo\.png"/);
  // Bad logos are EINPUT, found before the state is touched.
  const b = harness();
  await assert.rejects(setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme', logo: logoFile(b.themeDir, 'logo.jpg', 'x') }, b.deps), (e) => e.code === 'EINPUT');
  await assert.rejects(setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme', logo: path.join(b.themeDir, 'absent.svg') }, b.deps), (e) => e.code === 'EINPUT');
  assert.throws(() => installLogo(b.themeDir, logoFile(b.themeDir, 'empty.svg', '')), (e) => e.code === 'EINPUT');
});

test('an existing fork keeps its README unless --readme; --readme rewrites an untouched README, refuses an edited one (EEDITED) unless --force', async () => {
  const fresh = harness();
  await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme' }, fresh.deps);
  const file = path.join(fresh.themeDir, 'README.md');
  const hash = loadState(fresh.themeDir).site.theme.readmeHash;
  // A re-run (reused fork) without --readme: not rewritten, hash kept.
  const again = harness({ themeReused: true });
  again.deps.forkTheme = (o) => { again.calls.push(['fork', o]); return { themeDir: fresh.themeDir, slug: 'acme', reused: true, forkedFrom: 'proto-blocks-theme@1.0.0' }; };
  fs.writeFileSync(file, '# Edited by the developer\n');
  let r = await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme' }, again.deps);
  assert.equal(r.readme, null);
  assert.equal(fs.readFileSync(file, 'utf8'), '# Edited by the developer\n');
  assert.equal(loadState(fresh.themeDir).site.theme.readmeHash, hash);
  // --readme on the edited README: EEDITED, nothing written; --force overwrites.
  await assert.rejects(setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme', readme: true }, again.deps), (e) => e.code === 'EEDITED' && /edited since/.test(e.message));
  assert.equal(fs.readFileSync(file, 'utf8'), '# Edited by the developer\n');
  r = await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme', readme: true, force: true }, again.deps);
  assert.equal(fs.readFileSync(file, 'utf8'), README_PLAIN);
  assert.equal(r.readme.hash, hash);
  // Untouched README (what the tool wrote): --readme rewrites it (here with a logo added later).
  r = await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme', readme: true, logo: logoFile(fresh.themeDir, 'l.svg') }, again.deps);
  assert.match(fs.readFileSync(file, 'utf8'), /^<p align="center">\n  <img src="assets\/img\/logo\.svg"/);
  assert.notEqual(loadState(fresh.themeDir).site.theme.readmeHash, hash);
  // A logo alone on a reused fork: copied and recorded, README untouched (and the next --readme run uses it).
  const withLogo = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '# Mine\n');
  r = await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme', logo: logoFile(fresh.themeDir, 'l2.svg') }, again.deps);
  assert.deepEqual([r.logo, r.readme, fs.readFileSync(file, 'utf8')], ['assets/img/logo.svg', null, '# Mine\n']);
  assert.notEqual(withLogo, '# Mine\n');
  // A README nobody recorded (no readmeHash) on an existing fork: EEDITED too.
  const old = harness({ themeReused: true });
  fs.writeFileSync(path.join(old.themeDir, 'README.md'), '# inherited\n');
  fs.mkdirSync(path.join(old.themeDir, '.protoblocks'), { recursive: true });
  await setupSite({ cwd: '/c', name: 'Acme Co', slug: 'acme' }, harness().deps).catch(() => {});
  assert.throws(() => writeReadme(old.themeDir, { displayName: 'A', projectName: 'A', fresh: false }), (e) => e.code === 'EEDITED' && /no site\.theme\.readmeHash/.test(e.message));
  assert.equal(writeReadme(old.themeDir, { displayName: 'A', projectName: 'A', fresh: false, force: true }).logo, null);
  assert.equal(writeReadme(old.themeDir, { displayName: 'A', projectName: 'A', fresh: false }).hash, writeReadme(old.themeDir, { displayName: 'A', projectName: 'A', fresh: true }).hash, 'identical content is never a conflict');
});

test('parseArgs: --logo takes a file, --readme is a flag; the CLI usage lists both', () => {
  assert.deepEqual(parseArgs(['--name', 'A', '--logo', 'l.svg', '--readme']), { name: 'A', logo: 'l.svg', readme: true, force: false, updatePlugins: false });
  assert.throws(() => parseArgs(['--name', 'A', '--logo']), (e) => e.code === 'EUSAGE');
  const r = spawnSync(process.execPath, [CLI, '--logo'], { encoding: 'utf8' });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /\[--logo <file\.svg\|png>\] \[--readme\]/);
});
