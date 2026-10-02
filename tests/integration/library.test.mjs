import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itest, testWp, useItestTheme, restoreTheme } from './helpers.mjs';
import { listLibrary } from '../../skills/protoblocks-site-builder/scripts/lib/library.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blocks');

itest('listLibrary lists theme blocks with their schema summary', async () => {
  const wp = testWp();
  const slug = `pb-lib-itest-${process.pid}`;
  let dir;
  try {
    const theme = await useItestTheme(wp);
    dir = path.join(theme, 'proto-blocks', slug);
    fs.cpSync(path.join(FIX, 'pb-gate-ok'), dir, { recursive: true });
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'block.json'), 'utf8'));
    json.name = `proto-blocks/${slug}`;
    fs.writeFileSync(path.join(dir, 'block.json'), JSON.stringify(json));
    wp.check(['proto-blocks', 'cache', 'clear']);
    const lib = listLibrary(wp, theme);
    const entry = lib.find((e) => e.slug === slug);
    assert.ok(entry, JSON.stringify(lib));
    assert.deepEqual(entry.fields, { heading: 'text' });
    assert.equal(entry.innerBlocks, false);
    assert.deepEqual(entry.usedOn, []);
    assert.deepEqual(lib.map((e) => e.slug), lib.map((e) => e.slug).sort());
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    restoreTheme(wp);
  }
});
