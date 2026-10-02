import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWp, loadRuntime, WpError } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';

test('native mode prefixes --path; wrapper mode does not', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: 'x', stderr: '' }; };
  createWp({ wp: 'wp', mode: 'native', publicPath: '/s' }, { exec }).run(['option', 'get', 'siteurl']);
  createWp({ wp: '/w/wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }).run(['option', 'get', 'siteurl']);
  assert.deepEqual(calls[0], ['wp', ['--path=/s', 'option', 'get', 'siteurl']]);
  assert.deepEqual(calls[1], ['/w/wp', ['option', 'get', 'siteurl']]);
});

test('check throws WpError carrying stderr', () => {
  const exec = () => ({ code: 1, stdout: '', stderr: 'Error: boom' });
  const wp = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec });
  assert.throws(() => wp.check(['plugin', 'list']), (e) => e instanceof WpError && /boom/.test(e.message) && e.code === 'EWP');
});

test('evalFile parses the last JSON line, ignoring PHP notices above it', () => {
  const exec = () => ({ code: 0, stdout: 'Notice: something\n{"ok":true,"n":2}\n', stderr: '' });
  const wp = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec });
  assert.deepEqual(wp.evalFile('/x.php', ['a']), { ok: true, n: 2 });
});

test('evalFile without JSON output throws WpError', () => {
  const exec = () => ({ code: 0, stdout: 'not json\n', stderr: '' });
  const wp = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec });
  assert.throws(() => wp.evalFile('/x.php'), WpError);
});

test('loadRuntime reads preflight.json from inside a theme folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rt-'));
  fs.writeFileSync(path.join(root, 'wp-config.php'), '<?php');
  fs.mkdirSync(path.join(root, 'wp-content/.protoblocks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'wp-content/themes/acme'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wp-content/.protoblocks/preflight.json'),
    JSON.stringify({ ok: true, wp: '/w/wp', mode: 'local-wrapper', publicPath: root, url: 'http://a.local', localSite: null }));
  const rt = loadRuntime(path.join(root, 'wp-content/themes/acme'));
  assert.equal(rt.wp, '/w/wp');
  assert.equal(rt.url, 'http://a.local');
});

test('loadRuntime refuses a failed preflight report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rt-'));
  fs.writeFileSync(path.join(root, 'wp-config.php'), '<?php');
  fs.mkdirSync(path.join(root, 'wp-content/.protoblocks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wp-content/.protoblocks/preflight.json'), JSON.stringify({ ok: false, wp: null }));
  assert.throws(() => loadRuntime(root), (e) => e.code === 'ENORUNTIME' && /failed/.test(e.message));
});

test('loadRuntime without preflight throws ENORUNTIME', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rt-'));
  fs.writeFileSync(path.join(root, 'wp-config.php'), '<?php');
  assert.throws(() => loadRuntime(root), (e) => e.code === 'ENORUNTIME');
});

test('loadRuntime with malformed preflight.json throws ENORUNTIME', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rt-'));
  fs.writeFileSync(path.join(root, 'wp-config.php'), '<?php');
  fs.mkdirSync(path.join(root, 'wp-content/.protoblocks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wp-content/.protoblocks/preflight.json'), 'not valid json {');
  assert.throws(() => loadRuntime(root), (e) => e.code === 'ENORUNTIME' && /unreadable/.test(e.message));
});

// ---- Cross-cutting: WP-CLI argument injection ----
const recorder = (stdout = '{"ok":true}\n') => {
  const calls = [];
  const exec = (cmd, args) => { calls.push(args); return { code: 0, stdout, stderr: '' }; };
  return { calls, wp: createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec }) };
};

test('evalFile rejects dash-leading or non-string args with EARGV before running anything', () => {
  for (const bad of ['--exec=echo 1;', '--require=/tmp/x.php', '-x', '--', 5, null, undefined, {}]) {
    const { calls, wp } = recorder();
    assert.throws(() => wp.evalFile('/x.php', ['ok', bad]), (e) => e.code === 'EARGV', String(bad));
    assert.equal(calls.length, 0, `nothing executed for ${String(bad)}`);
  }
  const { calls, wp } = recorder();
  assert.throws(() => wp.evalFile('--exec=1', []), (e) => e.code === 'EARGV');
  assert.deepEqual(wp.evalFile('/x.php', ['status', 'a-b', '12']), { ok: true });
  assert.deepEqual(calls[0], ['eval-file', '/x.php', 'status', 'a-b', '12']);
});

test('check and run still pass WP-CLI flags through', () => {
  const { calls, wp } = recorder('x');
  wp.check(['plugin', 'get', 'x', '--field=status']);
  wp.run(['option', 'get', 'siteurl', '--format=json']);
  assert.deepEqual(calls, [['plugin', 'get', 'x', '--field=status'], ['option', 'get', 'siteurl', '--format=json']]);
});

test('evalFilePayload writes JSON to a temp file, passes [cmd, path] and always removes it', () => {
  let seen;
  const exec = (cmd, args) => {
    seen = { args, json: JSON.parse(fs.readFileSync(args.at(-1), 'utf8')) };
    return { code: 0, stdout: '{"done":1}\n', stderr: '' };
  };
  const wp = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec });
  const data = { key: '--exec=evil', label: 'He said "hi"' };
  assert.deepEqual(wp.evalFilePayload('/n.php', 'upsert', data), { done: 1 });
  assert.equal(seen.args[0], 'eval-file');
  assert.equal(seen.args[2], 'upsert');
  assert.equal(seen.args.length, 4);
  assert.deepEqual(seen.json, data);
  assert.equal(fs.existsSync(seen.args[3]), false, 'payload file removed');

  let file;
  const failing = createWp({ wp: 'wp', mode: 'local-wrapper', publicPath: '/s' }, { exec: (c, args) => { file = args.at(-1); return { code: 1, stdout: '', stderr: 'boom' }; } });
  assert.throws(() => failing.evalFilePayload('/n.php', 'upsert', {}), WpError);
  assert.equal(fs.existsSync(file), false, 'payload file removed after failure');
  assert.throws(() => failing.evalFilePayload('/n.php', '--exec=x', {}), (e) => e.code === 'EARGV');
});
