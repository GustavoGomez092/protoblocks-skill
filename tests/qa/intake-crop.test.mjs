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
  assert.deepEqual(secs.map((x) => x.ranges), [{ desktop: { y0: 0, y1: 300 } }, { desktop: { y0: 300, y1: 600 } }]);
  // A re-crop updates its breakpoint's range and keeps the other breakpoints'.
  const { updateState } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  updateState(theme, (st) => { st.pages[0].sections[0].ranges.mobile = { y0: 0, y1: 50 }; });
  await cropSections(theme, 'home', { desktop: [{ n: 1, y0: 0, y1: 280 }] });
  assert.deepEqual(loadState(theme).pages[0].sections[0].ranges, { desktop: { y0: 0, y1: 280 }, mobile: { y0: 0, y1: 50 } });
});

qtest('cropSections: a range with part gets the fixed anchor and crop name; an existing anchor is kept on re-crop', async () => {
  const { addFrame, cropSections } = await import('../../skills/protoblocks-site-builder/scripts/lib/intake.mjs');
  const { initState, loadState, updateState } = await import('../../skills/protoblocks-site-builder/scripts/lib/state.mjs');
  const theme = tmpDir();
  initState(theme, { url: 'http://a.local', path: '/x' });
  const img = await makeImage({ width: 1440, height: 600 }, path.join(theme, 'd.png'));
  addFrame(theme, 'home', 'desktop', img);
  await cropSections(theme, 'home', { desktop: [{ n: 1, y0: 0, y1: 100, part: 'header' }, { n: 2, y0: 100, y1: 500 }, { n: 3, y0: 500, y1: 600, part: 'footer' }] });
  let secs = loadState(theme).pages[0].sections;
  assert.deepEqual(secs.map((s) => s.anchor), ['pb-header', 'pb-s2', 'pb-footer']);
  assert.equal(path.basename(secs[0].crops.desktop), 'pb-header.png');
  assert.equal(path.basename(secs[2].crops.desktop), 'pb-footer.png');
  // the plan gate may set the anchor later; a re-crop without part keeps it and names the crop after it
  updateState(theme, (s) => { s.pages[0].sections[1].anchor = 'pb-s2'; });
  await cropSections(theme, 'home', { desktop: [{ n: 1, y0: 0, y1: 120 }, { n: 2, y0: 120, y1: 500 }] });
  secs = loadState(theme).pages[0].sections;
  assert.equal(secs[0].anchor, 'pb-header');
  assert.equal(path.basename(secs[0].crops.desktop), 'pb-header.png');
  // a part anchor already used by another n on this page is refused
  await assert.rejects(() => cropSections(theme, 'home', { desktop: [{ n: 2, y0: 0, y1: 100, part: 'header' }] }), (e) => e.code === 'ERANGES');
});
