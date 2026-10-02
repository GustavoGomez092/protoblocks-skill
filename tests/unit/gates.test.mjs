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
