import assert from 'node:assert/strict';
import path from 'node:path';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

const LIB = '../../skills/protoblocks-site-builder/scripts/lib';

async function withFixture(fn) {
  const { initState, updateState } = await import(`${LIB}/state.mjs`);
  const { shoot } = await import(path.join(QA_DIR, 'shoot.mjs'));
  const srv = await serveFixtures();
  try {
    const theme = tmpDir();
    initState(theme, { url: srv.url, path: '/x' });
    const url = `${srv.url}/section.html`;
    const snap = async (sel, name) => (await shoot({ url, selector: sel, width: 1440, out: path.join(theme, name) })).out;
    await fn({ theme, url, snap, updateState });
  } finally { await srv.close(); }
}
const base = (file, over = {}) => ({ page: 'fx', anchor: 'pb-s1', breakpoint: 'desktop', file, width: 1440, scale: 1, ...over });

qtest('regress passes against its own baseline and fails against a different one', async () => {
  const { regress } = await import(`${LIB}/regress.mjs`);
  await withFixture(async ({ theme, url, snap, updateState }) => {
    const good = await snap('#pb-s1', 'base1.png');
    const other = await snap('#pb-s2', 'base2.png');
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', url, sections: [] });
      s.library.hero = { usedOn: ['fx'], baselines: [base(good)] };
      s.library.cta = { usedOn: ['fx'], baselines: [base(other)] };
    });
    assert.equal((await regress(theme, 'hero')).pass, true);
    assert.equal((await regress(theme, 'cta')).pass, false);
  });
});

qtest('regress reports a missing baseline file as a failed result with a reason, and keeps going', async () => {
  const { regress } = await import(`${LIB}/regress.mjs`);
  await withFixture(async ({ theme, url, snap, updateState }) => {
    const good = await snap('#pb-s1', 'base1.png');
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', url, sections: [] });
      s.library.hero = { usedOn: ['fx'], baselines: [base(path.join(theme, 'gone.png'), { breakpoint: 'tablet' }), base(good)] };
    });
    const r = await regress(theme, 'hero');
    assert.equal(r.pass, false);
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].pass, false);
    assert.match(r.results[0].error, /baseline file missing/);
    assert.equal(r.results[1].pass, true);
  });
});

qtest('regress fails a baseline whose page has no url', async () => {
  const { regress } = await import(`${LIB}/regress.mjs`);
  await withFixture(async ({ theme, snap, updateState }) => {
    const good = await snap('#pb-s1', 'base1.png');
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', sections: [] });
      s.library.hero = { usedOn: ['fx'], baselines: [base(good)] };
    });
    const r = await regress(theme, 'hero');
    assert.equal(r.pass, false);
    assert.match(r.results[0].error, /no url/);
  });
});

qtest('regress rejects an unsafe anchor instead of building a selector from it', async () => {
  const { regress } = await import(`${LIB}/regress.mjs`);
  await withFixture(async ({ theme, url, snap, updateState }) => {
    const good = await snap('#pb-s1', 'base1.png');
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', url, sections: [] });
      s.library.hero = { usedOn: ['fx'], baselines: [base(good, { anchor: 'pb-s1, body' }), base(good, { anchor: 'x y' })] };
    });
    const r = await regress(theme, 'hero');
    assert.equal(r.pass, false);
    for (const x of r.results) assert.match(x.error, /anchor/);
  });
});

qtest('regress leaves a caller-supplied browser open and fails (not crashes) on an unknown block with a bad URL', async () => {
  const { regress } = await import(`${LIB}/regress.mjs`);
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
  await withFixture(async ({ theme, snap, updateState }) => {
    const good = await snap('#pb-s1', 'base1.png');
    updateState(theme, (s) => {
      s.pages.push({ slug: 'fx', status: 'building', url: 'http://127.0.0.1:1/never', sections: [] });
      s.library.hero = { usedOn: ['fx'], baselines: [base(good)] };
    });
    const browser = await launchBrowser();
    try {
      const r = await regress(theme, 'hero', { browser });
      assert.equal(r.pass, false);
      assert.ok(r.results[0].error);
      assert.equal(browser.isConnected(), true);
    } finally { await browser.close(); }
  });
});
