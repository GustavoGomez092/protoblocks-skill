import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exec } from '../../skills/protoblocks-site-builder/scripts/lib/exec.mjs';

test('exec captures stdout and exit code', () => {
  const r = exec(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, 'hi');
});

test('exec returns 127 for a missing binary instead of throwing', () => {
  const r = exec('definitely-not-a-binary-xyz', []);
  assert.equal(r.code, 127);
  assert.match(r.stderr, /ENOENT|not found/i);
});
