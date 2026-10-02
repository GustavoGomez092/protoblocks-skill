import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qtest, makeImage, tmpDir } from './helpers.mjs';

qtest('cropSections records crops in state', async () => {
  const { addFrame, cropSections } = await import('../../skills/protoblocks-site-builder/scripts/lib/intake.mjs');
  const { initState, loadState } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  const theme = tmpDir();
  initState(theme, { url: 'http://a.local', path: '/x' });
  const img = await makeImage({ width: 1440, height: 600 }, path.join(theme, 'd.png'));
  addFrame(theme, 'home', 'desktop', img);
  const out = await cropSections(theme, 'home', { desktop: [{ n: 1, y0: 0, y1: 300 }, { n: 2, y0: 300, y1: 600 }] });
  assert.equal(out.length, 2);
  const secs = loadState(theme).pages[0].sections;
  assert.deepEqual(secs.map((s) => s.anchor), ['pb-s1', 'pb-s2']);
  assert.ok(fs.existsSync(secs[1].crops.desktop));
});
