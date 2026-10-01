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
