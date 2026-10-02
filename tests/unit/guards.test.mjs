import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertFork } from '../../skills/protoblocks-site-builder/scripts/lib/guards.mjs';
import { assertStateSite, loadThemeRuntime } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { applyTokens } from '../../skills/protoblocks-site-builder/scripts/lib/tokens.mjs';
import { writePart } from '../../skills/protoblocks-site-builder/scripts/lib/parts.mjs';
import { installThemeAssets } from '../../skills/protoblocks-site-builder/scripts/lib/theme-assets.mjs';
import { initState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'protoblocks-site-builder', 'scripts', 'lib');
const UPSTREAM = '/*\nTheme Name: Proto-theme\nText Domain: proto-theme\n*/\nbody {\n  font-family: "Inter", sans-serif;\n}\n';

// A theme folder that looks like the developer's upstream checkout: no fork marker, no build state.
function upstreamTheme() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-upstream-'));
  fs.writeFileSync(path.join(dir, 'style.css'), UPSTREAM);
  fs.writeFileSync(path.join(dir, 'theme.json'), '{"version":3}');
  fs.writeFileSync(path.join(dir, 'functions.php'), '<?php\n');
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}
const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
  const p = path.join(dir, f);
  return fs.statSync(p).isFile() ? `${f}:${fs.readFileSync(p, 'utf8')}` : f;
});

test('assertFork accepts a fork marker or build state, and refuses anything else with ENOTFORK', () => {
  const up = upstreamTheme();
  assert.throws(() => assertFork(up), (e) => e.code === 'ENOTFORK' && e.message.includes(up));
  assert.throws(() => assertFork(path.join(up, 'missing')), (e) => e.code === 'ENOTFORK');
  const fork = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-fork-'));
  fs.writeFileSync(path.join(fork, 'style.css'), '/*\nProto Fork: proto-blocks-theme@1.1.3\n*/');
  assert.doesNotThrow(() => assertFork(fork));
  const stated = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-fork-'));
  initState(stated, { url: 'http://x.local', path: '/x' });
  assert.doesNotThrow(() => assertFork(stated));
});

test('tokens apply, parts write and theme-assets install never touch a non-fork theme', () => {
  const up = upstreamTheme();
  const before = snapshot(up);
  assert.throws(() => applyTokens(up, { colors: { a: '#000' }, fonts: { sans: { family: 'Work Sans' } } }), (e) => e.code === 'ENOTFORK');
  assert.throws(() => writePart(up, 'header', 'X'), (e) => e.code === 'ENOTFORK');
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-assets-'));
  fs.mkdirSync(path.join(assets, 'inc'));
  fs.writeFileSync(path.join(assets, 'inc', 'pb-a.php'), '<?php');
  assert.throws(() => installThemeAssets(up, assets), (e) => e.code === 'ENOTFORK');
  assert.deepEqual(snapshot(up), before, 'upstream theme byte-identical');
});

// A fake WP root whose preflight says http://this.local, holding a fork whose state belongs to another site.
function wrongSite(stateUrl = 'http://other.local') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-wrongsite-'));
  fs.writeFileSync(path.join(root, 'wp-config.php'), '<?php');
  fs.mkdirSync(path.join(root, 'wp-content', '.protoblocks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wp-content', '.protoblocks', 'preflight.json'),
    JSON.stringify({ ok: true, wp: '/nonexistent/wp', mode: 'local-wrapper', publicPath: root, url: 'http://this.local' }));
  const theme = path.join(root, 'wp-content', 'themes', 'acme');
  fs.mkdirSync(theme, { recursive: true });
  fs.writeFileSync(path.join(theme, 'style.css'), '/*\nProto Fork: proto-blocks-theme@1.1.3\n*/\nbody {\n  font-family: a;\n}\n');
  fs.writeFileSync(path.join(theme, 'theme.json'), '{"version":3}');
  initState(theme, { url: stateUrl, path: root });
  return { root, theme };
}

test('assertStateSite: EWRONGSITE on a different url; trailing slash and no state are fine', () => {
  const { theme } = wrongSite();
  assert.throws(() => assertStateSite(theme, { url: 'http://this.local' }), (e) => e.code === 'EWRONGSITE' && /other\.local/.test(e.message) && /this\.local/.test(e.message));
  const same = wrongSite('http://this.local/');
  assert.doesNotThrow(() => assertStateSite(same.theme, { url: 'http://this.local' }));
  assert.doesNotThrow(() => assertStateSite(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-nostate-')), { url: 'http://this.local' }));
  assert.throws(() => loadThemeRuntime(theme), (e) => e.code === 'EWRONGSITE');
  assert.equal(loadThemeRuntime(same.theme).url, 'http://this.local');
});

test('state-mutating CLIs refuse with EWRONGSITE and change nothing', () => {
  const { theme } = wrongSite();
  const spec = path.join(theme, '..', 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ colors: { a: '#000' }, items: [] }));
  const markup = path.join(theme, '..', 'm.html');
  fs.writeFileSync(markup, 'X');
  const before = snapshot(theme);
  for (const [script, args] of [
    ['tokens.mjs', ['apply', theme, spec, '--no-compile']],
    ['tokens.mjs', ['apply', theme, spec]],
    ['navigation.mjs', ['upsert', theme, 'primary', spec]],
    ['navigation.mjs', ['refresh', theme]],
    ['parts.mjs', ['write', theme, 'header', markup]],
    ['parts.mjs', ['overrides', theme]],
  ]) {
    const r = spawnSync(process.execPath, [path.join(LIB, script), ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1, `${script} ${args[0]}: ${r.stderr}`);
    assert.match(r.stderr, /\[EWRONGSITE\]/, `${script} ${args[0]}`);
  }
  assert.deepEqual(snapshot(theme), before);
});
