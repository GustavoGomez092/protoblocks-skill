import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { WpError } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { runGates } from '../../skills/protoblocks-site-builder/scripts/lib/gates.mjs';

function setup({ anchor = true, validate, cache, tailwind = { enabled: false }, compile, render } = {}) {
  const theme = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
  fs.mkdirSync(path.join(theme, 'proto-blocks', 'b'), { recursive: true });
  fs.writeFileSync(path.join(theme, 'proto-blocks', 'b', 'block.json'), JSON.stringify({ supports: anchor ? { anchor: true } : {} }));
  const calls = [];
  const wp = {
    check: () => theme,
    run: (args) => {
      calls.push(args.join(' '));
      if (args[1] === 'validate') return validate ?? { code: 0, stdout: '[{"block":"b","status":"valid"}]\n', stderr: '' };
      if (args[1] === 'cache') return cache ?? { code: 0, stdout: 'Success\n', stderr: '' };
      return compile ?? { code: 0, stdout: 'compiled\n', stderr: '' };
    },
    evalFile: (file) => {
      calls.push(path.basename(file));
      return path.basename(file) === 'tailwind.php' ? tailwind : (render ?? { ok: true, errors: [], other: [] });
    },
  };
  return { wp, calls };
}
const ids = (r) => r.steps.map((s) => s.id);

test('runs all steps in order for a good block', () => {
  const { wp } = setup();
  const r = runGates(wp, { block: 'b' });
  assert.equal(r.ok, true);
  assert.deepEqual(ids(r), ['anchor-support', 'validate', 'cache', 'tailwind', 'render']);
  assert.equal(r.steps[3].detail, 'disabled');
});

test('stops at anchor-support without calling wp', () => {
  const { wp, calls } = setup({ anchor: false });
  const r = runGates(wp, { block: 'b' });
  assert.equal(r.ok, false);
  assert.deepEqual(ids(r), ['anchor-support']);
  assert.deepEqual(calls, []);
});

test('stops at validate on error status', () => {
  const { wp } = setup({ validate: { code: 0, stdout: '[{"block":"b","status":"error"}]', stderr: '' } });
  assert.deepEqual(ids(runGates(wp, { block: 'b' })), ['anchor-support', 'validate']);
});

test('warning status does not fail validate', () => {
  const { wp } = setup({ validate: { code: 0, stdout: '[{"block":"b","status":"warning"}]', stderr: '' } });
  assert.equal(runGates(wp, { block: 'b' }).ok, true);
});

test('stops at cache failure', () => {
  const { wp } = setup({ cache: { code: 1, stdout: '', stderr: 'boom' } });
  assert.deepEqual(ids(runGates(wp, { block: 'b' })), ['anchor-support', 'validate', 'cache']);
});

test('compiles tailwind when enabled and stops on failure', () => {
  const { wp, calls } = setup({ tailwind: { enabled: true }, compile: { code: 1, stdout: '', stderr: 'tw fail' } });
  const r = runGates(wp, { block: 'b' });
  assert.deepEqual(ids(r), ['anchor-support', 'validate', 'cache', 'tailwind']);
  assert.ok(calls.includes('eval-file ' + path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'skills/protoblocks-site-builder/scripts/wp/tailwind.php') + ' compile'));
});

test('render failure is the final failing step', () => {
  const { wp } = setup({ render: { ok: false, errors: [{ message: 'Undefined array key' }], other: [] } });
  const r = runGates(wp, { block: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.steps.at(-1).id, 'render');
  assert.equal(r.steps.at(-1).ok, false);
});

test('validate parses JSON that is followed by text on the same line (plugin 2.10.1 output)', () => {
  const { wp } = setup({ validate: { code: 0, stdout: '[{"block":"b","status":"valid","message":"OK [x]"}]Success: All blocks validated successfully.\n', stderr: '' } });
  assert.equal(runGates(wp, { block: 'b' }).ok, true);
});

test('validate fails when the block is absent from the JSON rows', () => {
  const { wp } = setup({ validate: { code: 0, stdout: '[]Success\n', stderr: '' } });
  assert.deepEqual(ids(runGates(wp, { block: 'b' })), ['anchor-support', 'validate']);
});

test('a fatal in render-block.php (evalFile throws) is recorded as a failing render step', () => {
  const { wp } = setup();
  const orig = wp.evalFile;
  wp.evalFile = (file, args) => {
    if (path.basename(file) === 'render-block.php') throw new WpError(['eval-file'], { code: 255, stdout: '', stderr: 'PHP Parse error: syntax error' });
    return orig(file, args);
  };
  const r = runGates(wp, { block: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.steps.at(-1).id, 'render');
  assert.equal(r.steps.at(-1).ok, false);
  assert.match(r.steps.at(-1).detail.fatal, /Parse error/);
});

test('no administrator user is reported as a distinct environment failure', () => {
  const { wp } = setup({ render: { ok: false, environment: 'no administrator user found' } });
  const r = runGates(wp, { block: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.steps.at(-1).id, 'render');
  assert.deepEqual(r.steps.at(-1).detail, { environment: 'no administrator user found' });
});

test('validate parsing skips an earlier "[" that is not the JSON array', () => {
  const { wp } = setup({ validate: { code: 0, stdout: 'Notice: [deprecated] something\n[{"block":"b","status":"valid"}]Success\n', stderr: '' } });
  assert.equal(runGates(wp, { block: 'b' }).ok, true);
});

function fatalWp(result) {
  const { wp } = setup();
  const orig = wp.evalFile;
  wp.evalFile = (file, args) => {
    if (path.basename(file) === 'render-block.php') throw new WpError(['eval-file'], result);
    return orig(file, args);
  };
  return wp;
}

test('PHP fatal text in the failed process stdout becomes detail.fatal {message,file,line} with raw kept', () => {
  const raw = '\nFatal error: Allowed memory size of 50331648 bytes exhausted (tried to allocate 10485792 bytes) in /x y/pb-gate-fatal/template.php on line 3\nThere has been a critical error\n';
  const r = runGates(fatalWp({ code: 255, stdout: raw, stderr: 'Error: critical' }), { block: 'b' });
  const last = r.steps.at(-1);
  assert.equal(last.id, 'render');
  assert.equal(last.ok, false);
  assert.deepEqual(last.detail.fatal, { message: 'Allowed memory size of 50331648 bytes exhausted (tried to allocate 10485792 bytes)', file: '/x y/pb-gate-fatal/template.php', line: 3 });
  assert.equal(last.detail.raw, raw);
});

test('a PHP parse error fatal line is parsed the same way', () => {
  const raw = 'PHP Parse error:  syntax error, unexpected token ";" in /t/template.php on line 1\n';
  const last = runGates(fatalWp({ code: 255, stdout: raw, stderr: '' }), { block: 'b' }).steps.at(-1);
  assert.equal(last.detail.fatal.file, '/t/template.php');
  assert.match(last.detail.fatal.message, /syntax error/);
});

test('a WpError for non-JSON output keeps the first 2000 chars of stdout as detail.raw', () => {
  const stdout = 'x'.repeat(3000);
  const r = runGates(fatalWp({ code: 0, stdout, stderr: 'eval-file did not print JSON on its last line' }), { block: 'b' });
  const last = r.steps.at(-1);
  assert.equal(last.ok, false);
  assert.equal(last.detail.raw, stdout.slice(0, 2000));
  assert.match(last.detail.fatal, /did not print JSON/);
});
