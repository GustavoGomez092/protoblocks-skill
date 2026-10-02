import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, makeImage } from './helpers.mjs';

const LIB = '../../skills/protoblocks-site-builder/scripts/lib';

qtest('buildCheckInput/prepareCheck output is accepted by the real check-section validation', async () => {
  const { prepareCheck } = await import(`${LIB}/qa-input.mjs`);
  const { initState, updateState } = await import(`${LIB}/state.mjs`);
  const { checkSection } = await import('../../skills/protoblocks-site-builder/scripts/qa/check-section.mjs');
  const srv = await serveFixtures();
  try {
    const theme = tmpDir();
    initState(theme, { url: srv.url, path: '/x' });
    const crop = await makeImage({ width: 1440, height: 400 }, path.join(theme, 'crop.png'));
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', url: `${srv.url}/section.html`,
        design: { frames: [{ breakpoint: 'desktop', width: 1440, scale: 1, image: crop }] },
        sections: [{ n: 1, anchor: 'pb-s1', block: 'hero', status: 'building', crops: { desktop: crop }, qa: [] }] });
    });
    const { input } = prepareCheck(theme, 'fx', 1);
    const res = await checkSection(JSON.parse((await import('node:fs')).readFileSync(input, 'utf8')));
    // validate() throws EINPUT/EANCHOR before any work; reaching results proves the input shape is accepted
    assert.ok(Array.isArray(res.results));
    assert.deepEqual(res.results.map((r) => r.breakpoint), ['desktop', 'tablet', 'mobile']);
  } finally { await srv.close(); }
});
