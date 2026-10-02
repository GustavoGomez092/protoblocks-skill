import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { qtest, serveFixtures, QA_DIR } from './helpers.mjs';

const load = () => import(path.join(QA_DIR, 'sanity.mjs'));

qtest('sanity flags overflow, small text, tap targets, broken images and overlap on mobile', async () => {
  const { sanity } = await load();
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/broken.html`, selector: '#pb-s1', width: 390 });
    const types = new Set(r.issues.map((i) => i.type));
    for (const t of ['overflow', 'small-text', 'tap-target', 'broken-image', 'overlap']) assert.ok(types.has(t), `missing ${t}: ${JSON.stringify(r.issues)}`);
    assert.equal(r.ok, false);
  } finally { await srv.close(); }
});

// One focused test per issue type so each detector has its own regression guard.
const PER_TYPE = {
  overflow: /^div\.wide extends to 9\d\dpx/,
  'small-text': /^p\.tiny font-size 10px/,
  'tap-target': /^a /,
  'broken-image': /does-not-exist\.png/,
  overlap: /^p\.a overlaps p\.b/,
};
for (const [type, re] of Object.entries(PER_TYPE)) {
  qtest(`sanity detects ${type} with a useful detail`, async () => {
    const { sanity } = await load();
    const srv = await serveFixtures();
    try {
      const r = await sanity({ url: `${srv.url}/broken.html`, selector: '#pb-s1', width: 390 });
      const hit = r.issues.filter((i) => i.type === type);
      assert.ok(hit.some((i) => re.test(i.detail)), `${type} ${re}: ${JSON.stringify(r.issues)}`);
    } finally { await srv.close(); }
  });
}

qtest('sanity reports a missing selector', async () => {
  const { sanity } = await load();
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/broken.html`, selector: '#nope', width: 390 });
    assert.deepEqual(r.issues, [{ type: 'missing', detail: '#nope not found' }]);
    assert.equal(r.ok, false);
  } finally { await srv.close(); }
});

qtest('sanity does not flag tap targets above 480px', async () => {
  const { sanity } = await load();
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/broken.html`, selector: '#pb-s1', width: 481 });
    assert.equal(r.issues.filter((i) => i.type === 'tap-target').length, 0);
    const m = await sanity({ url: `${srv.url}/broken.html`, selector: '#pb-s1', width: 480 });
    assert.ok(m.issues.some((i) => i.type === 'tap-target'), 'still checked at exactly 480');
  } finally { await srv.close(); }
});

qtest('sanity scoped to a clean section reports no section issues', async () => {
  const { sanity } = await load();
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/broken.html`, selector: '#pb-s2', width: 390 });
    const sectionIssues = r.issues.filter((i) => !i.detail.startsWith('page scrollWidth'));
    assert.deepEqual(sectionIssues, []);
  } finally { await srv.close(); }
});

qtest('sanity de-duplicates identical issues', async () => {
  const { sanity } = await load();
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/dupes.html`, selector: '#pb-s1', width: 1280 });
    assert.equal(r.issues.filter((i) => i.type === 'small-text').length, 1, JSON.stringify(r.issues));
  } finally { await srv.close(); }
});

qtest('sanity caps issues at 50', async () => {
  const { sanity } = await load();
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/many.html`, selector: '#pb-s1', width: 1280 });
    assert.equal(r.issues.length, 50);
  } finally { await srv.close(); }
});

qtest('sanity surfaces never-loading images as image-timeout', { timeout: 30000 }, async () => {
  const { sanity } = await load();
  const srv = await serveFixtures();
  try {
    const r = await sanity({ url: `${srv.url}/hang.html`, selector: '#pb-s1', width: 800 });
    const hit = r.issues.filter((i) => i.type === 'image-timeout');
    assert.equal(hit.length, 1, JSON.stringify(r.issues));
    assert.match(hit[0].detail, /__hang/);
    assert.equal(r.ok, false);
  } finally { await srv.close(); }
});

qtest('sanity closes its context when inspection throws (injected browser)', async () => {
  const { sanity } = await load();
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
  const srv = await serveFixtures();
  const b = await launchBrowser();
  try {
    await assert.rejects(sanity({ url: `${srv.url}/broken.html`, selector: '##bad', width: 390, browser: b }));
    assert.equal(b.contexts().length, 0, 'context leaked');
    assert.ok(b.isConnected(), 'caller-owned browser must stay open');
  } finally { await b.close(); await srv.close(); }
});

const childCount = () => {
  try { return execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).length; } catch { return 0; }
};

qtest('sanity closes a browser it launched itself when inspection throws', async () => {
  const { sanity } = await load();
  const srv = await serveFixtures();
  try {
    const before = childCount();
    await assert.rejects(sanity({ url: `${srv.url}/broken.html`, selector: '##bad', width: 390 }));
    let after = childCount();
    for (let i = 0; i < 20 && after > before; i++) { await new Promise((r) => setTimeout(r, 100)); after = childCount(); }
    assert.equal(after, before, 'browser process leaked');
  } finally { await srv.close(); }
});
