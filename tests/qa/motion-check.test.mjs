import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { qtest, tmpDir, serveFixtures, QA_DIR } from './helpers.mjs';

qtest('motionCheck passes clean motion, fails residue, and checks Taxi re-init', async () => {
  const { motionCheck } = await import(path.join(QA_DIR, 'motion-check.mjs'));
  const srv = await serveFixtures();
  try {
    const good = await motionCheck({ url: `${srv.url}/motion.html`, anchor: 'pb-s1', width: 1280, outDir: tmpDir() });
    assert.equal(good.pass, true, JSON.stringify(good, null, 2));
    assert.equal(good.taxi.checked, false);

    const bad = await motionCheck({ url: `${srv.url}/motion-broken.html`, anchor: 'pb-s1', width: 1280, outDir: tmpDir() });
    assert.equal(bad.pass, false);
    assert.ok(bad.settledMismatch > 0.02, `mismatch ${bad.settledMismatch}`);

    const taxi = await motionCheck({ url: `${srv.url}/motion-taxi.html`, anchor: 'pb-s1', width: 1280, outDir: tmpDir() });
    assert.equal(taxi.taxi.checked, true);
    assert.equal(taxi.taxi.before, taxi.taxi.after, JSON.stringify(taxi.taxi));
    assert.equal(taxi.pass, true, JSON.stringify(taxi, null, 2));
  } finally { await srv.close().catch(() => {}); }
});

// Each fault below breaks exactly one rule. The "everything else is clean" asserts make sure the failing
// rule is the only reason pass is false, so dropping that rule from motionCheck turns the test red.
async function withChecker(fn) {
  const { motionCheck } = await import(path.join(QA_DIR, 'motion-check.mjs'));
  const { launchBrowser } = await import(path.join(QA_DIR, 'browser.mjs'));
  const srv = await serveFixtures();
  let browser;
  try {
    browser = await launchBrowser();
    await fn((page, extra = {}) => motionCheck({ url: `${srv.url}/${page}`, anchor: 'pb-s1', width: 1280, outDir: tmpDir(), browser, ...extra }));
  } finally {
    await browser?.close().catch(() => {});
    await srv.close().catch(() => {});
  }
}

const clean = (r, except) => {
  const dump = JSON.stringify(r, null, 2);
  if (except !== 'mismatch') assert.ok(r.settledMismatch <= 0.02, `settledMismatch clean: ${dump}`);
  if (except !== 'cls') assert.ok(r.cls <= 0.01, `cls clean: ${dump}`);
  if (except !== 'pageErrors') assert.deepEqual(r.pageErrors, [], `pageErrors clean: ${dump}`);
  if (except !== 'unsettled') assert.deepEqual(r.unsettled, [], `unsettled clean: ${dump}`);
  if (except !== 'imageErrors') assert.deepEqual(r.imageErrors, [], `imageErrors clean: ${dump}`);
  if (except !== 'taxi' && r.taxi.checked) {
    assert.equal(r.taxi.error, undefined, `taxi error clean: ${dump}`);
    assert.equal(r.taxi.before, r.taxi.after, `taxi counts clean: ${dump}`);
    assert.deepEqual(r.taxi.unsettled, [], `taxi re-settle clean: ${dump}`);
    assert.deepEqual(r.taxi.duplicates, [], `taxi duplicates clean: ${dump}`);
  }
};

qtest('motionCheck: the fault fixture with no fault passes (control)', () => withChecker(async (check) => {
  const r = await check('motion-faults.html');
  clean(r);
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
}));

qtest('motionCheck fails on layout shift during motion (CLS)', () => withChecker(async (check) => {
  const r = await check('motion-faults.html?fault=cls');
  assert.ok(r.cls > 0.01, `cls ${r.cls}`);
  clean(r, 'cls');
  assert.equal(r.pass, false);
}));

qtest('motionCheck fails on uncaught page errors', () => withChecker(async (check) => {
  const r = await check('motion-faults.html?fault=error');
  assert.ok(r.pageErrors.some((e) => e.includes('motion-fault-boom')), JSON.stringify(r.pageErrors));
  clean(r, 'pageErrors');
  assert.equal(r.pass, false);
}));

qtest('motionCheck fails and names reveal elements that never settle', () => withChecker(async (check) => {
  const r = await check('motion-faults.html?fault=stuck');
  assert.deepEqual(r.unsettled, ['stuck']);
  clean(r, 'unsettled');
  assert.equal(r.pass, false);
}));

// imageWaitMs must reach both page loads: at the default 10s per load this cannot finish inside the timeout.
qtest('motionCheck fails and reports images inside the anchor that never load', { timeout: 16000 }, () => withChecker(async (check) => {
  const r = await check('motion-faults.html?fault=hang', { anchor: 'pb-hang', imageWaitMs: 1000 });
  assert.ok(r.imageErrors.length > 0 && r.imageErrors.every((src) => src.endsWith('/__hang')), JSON.stringify(r.imageErrors));
  assert.deepEqual(r.pageImageWarnings, [], JSON.stringify(r.pageImageWarnings));
  clean(r, 'imageErrors');
  assert.equal(r.pass, false);
}));

// Same stalled image, but the anchor is #pb-s1: like shoot, only the anchor's images can fail the check.
qtest('motionCheck reports a stalled image outside the anchor as a pageImageWarning and still passes', { timeout: 16000 }, () => withChecker(async (check) => {
  const r = await check('motion-faults.html?fault=hang', { imageWaitMs: 1000 });
  assert.ok(r.pageImageWarnings.length > 0 && r.pageImageWarnings.every((src) => src.endsWith('/__hang')), JSON.stringify(r.pageImageWarnings));
  clean(r);
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
}));

// The reduced shot comes from shoot, which hides fixed/sticky chrome outside the anchor. The settled shot must hide
// it too, or a fixed header stitched into a taller-than-viewport anchor shot reads as settle residue.
qtest('motionCheck: a fixed header and sticky nav over a tall anchor are not settled mismatch', () => withChecker(async (check) => {
  const r = await check('motion-fixed-header.html');
  assert.ok(r.settledMismatch <= 0.02, `settledMismatch ${r.settledMismatch}`);
  clean(r);
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
}));

qtest('motionCheck fails when Taxi navigation leaks ScrollTriggers', () => withChecker(async (check) => {
  const r = await check('motion-taxi.html?leak=1');
  assert.equal(r.taxi.checked, true);
  assert.ok(r.taxi.after > r.taxi.before, JSON.stringify(r.taxi));
  assert.deepEqual(r.taxi.unsettled, [], JSON.stringify(r.taxi));
  clean(r, 'taxi');
  assert.equal(r.pass, false);
}));

qtest('motionCheck fails when motion is not re-initialised after Taxi navigation', () => withChecker(async (check) => {
  const r = await check('motion-taxi.html?noinit=1');
  assert.equal(r.taxi.checked, true);
  assert.deepEqual(r.taxi.unsettled.sort(), ['row', 't1', 't2'], JSON.stringify(r.taxi));
  clean(r, 'taxi');
  assert.equal(r.pass, false);
}));

qtest('motionCheck: CLS counts only shifts inside the anchor; page-wide CLS is informational', () => withChecker(async (check) => {
  const r = await check('motion-faults.html?fault=cls-outside');
  assert.ok(r.clsPage > 0.01, `clsPage ${r.clsPage}`);
  clean(r);
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
}));

qtest('motionCheck: CLS fault inside the anchor is also reported page-wide', () => withChecker(async (check) => {
  const r = await check('motion-faults.html?fault=cls');
  assert.ok(r.clsPage >= r.cls && r.cls > 0.01, JSON.stringify({ cls: r.cls, clsPage: r.clsPage }));
}));

qtest('motionCheck fails on duplicate ScrollTriggers per motion element even when counts are stable', () => withChecker(async (check) => {
  const r = await check('motion-taxi.html?dup=1');
  assert.equal(r.taxi.before, r.taxi.after, `leak check passes: ${JSON.stringify(r.taxi)}`);
  assert.deepEqual([...r.taxi.duplicates].sort(), ['c1', 'c2', 'c3', 'clip'], JSON.stringify(r.taxi));
  clean(r, 'taxi');
  assert.deepEqual(r.taxi.unsettled, []);
  assert.equal(r.taxi.error, undefined);
  assert.equal(r.pass, false);
}));

qtest('motionCheck retries navigateTo while Taxi refuses interruption, without page errors', () => withChecker(async (check) => {
  const r = await check('motion-taxi.html?lock=1');
  assert.ok(r.taxi.retries > 0, `rejections were retried: ${JSON.stringify(r.taxi)}`);
  clean(r);
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
}));

qtest('motionCheck waits for core.isTransitioning to clear instead of hitting the lock', () => withChecker(async (check) => {
  const r = await check('motion-taxi.html?lock=flag');
  assert.equal(r.taxi.retries, 0, JSON.stringify(r.taxi));
  clean(r);
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
}));

qtest('motionCheck records ETAXI when page-ready never fires, and still reports everything else', () => withChecker(async (check) => {
  const outDir = tmpDir();
  const r = await check('motion-taxi.html?noready=1', { outDir });
  assert.match(r.taxi.error ?? '', /^ETAXI: proto:page-ready/, JSON.stringify(r.taxi));
  assert.equal(r.taxi.checked, true);
  clean(r, 'taxi');
  assert.equal(r.pass, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'motion-check.json'), 'utf8')), r);
}));

qtest('motionCheck: page URL with a #fragment gets a well-formed away URL and passes', () => withChecker(async (check) => {
  const r = await check('motion-taxi.html#pb-s1');
  const away = new URL(r.taxi.away);
  assert.equal(away.searchParams.get('pb-motion-away'), '1', r.taxi.away);
  assert.equal(away.hash, '', r.taxi.away);
  clean(r);
  assert.equal(r.pass, true, JSON.stringify(r, null, 2));
}));

qtest('motionCheck records ETAXI when Taxi falls back to a hard navigation, and still writes the report', () => withChecker(async (check) => {
  const outDir = tmpDir();
  const r = await check('motion-taxi.html?hardnav=1', { outDir });
  assert.match(r.taxi.error ?? '', /^ETAXI: .*hard navigation/, JSON.stringify(r.taxi));
  clean(r, 'taxi');
  assert.equal(r.pass, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'motion-check.json'), 'utf8')), r);
}));

qtest('motionCheck does not retry rejections other than the transition lock', () => withChecker(async (check) => {
  const r = await check('motion-taxi.html?reject=1');
  assert.equal(r.taxi.retries, 0, JSON.stringify(r.taxi));
  assert.match(r.taxi.error ?? '', /^ETAXI: .*fake taxi: network down/, JSON.stringify(r.taxi));
  clean(r, 'taxi');
  assert.equal(r.pass, false);
}));

qtest('motionCheck writes reduced.png, settled.png and motion-check.json', () => withChecker(async (check) => {
  const outDir = tmpDir();
  const r = await check('motion.html', { outDir });
  for (const f of ['reduced.png', 'settled.png', 'motion-check.json']) assert.ok(fs.existsSync(path.join(outDir, f)), f);
  assert.equal(r.reduced, path.join(outDir, 'reduced.png'));
  assert.equal(r.settled, path.join(outDir, 'settled.png'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'motion-check.json'), 'utf8')), r);
}));

const runCli = (args) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(QA_DIR, 'motion-check.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { err += d; });
  c.on('close', (code) => resolve({ code, out, err }));
});

qtest('motion-check CLI: usage exit 64, exit 1 when the check fails', async () => {
  const usage = await runCli([]);
  assert.equal(usage.code, 64);
  assert.match(usage.err, /Usage: node motion-check\.mjs/);
  const srv = await serveFixtures();
  try {
    const outDir = tmpDir();
    const r = await runCli(['--url', `${srv.url}/motion-broken.html`, '--anchor', 'pb-s1', '--out', outDir, '--width', '1280']);
    assert.equal(r.code, 1, r.err);
    assert.equal(JSON.parse(r.out).pass, false);
    assert.ok(fs.existsSync(path.join(outDir, 'motion-check.json')));
  } finally { await srv.close().catch(() => {}); }
});
