import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROFILES, setProfile, recordMotion, installMotion } from '../../skills/protoblocks-site-builder/scripts/lib/motion.mjs';
import { initState, updateState, loadState } from '../../skills/protoblocks-site-builder/scripts/lib/state.mjs';

function theme() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-mo-'));
  fs.mkdirSync(path.join(t, 'inc'));
  initState(t, { url: 'http://a.local', path: '/x' });
  updateState(t, (s) => { s.pages.push({ slug: 'home', status: 'building', sections: [{ n: 1, anchor: 'pb-s1', block: 'hero', status: 'animating' }] }); });
  return t;
}

test('profiles have the documented values', () => {
  assert.deepEqual(PROFILES.subtle, { duration: 0.7, ease: 'power2.out', stagger: 0.08, distance: 24 });
  assert.deepEqual(PROFILES.bold, { duration: 1.1, ease: 'expo.out', stagger: 0.12, distance: 64 });
});

test('setProfile writes the theme file and state; rejects bad custom profiles', () => {
  const t = theme();
  setProfile(t, 'expressive');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t, 'inc/pb-motion-profile.json'), 'utf8')), PROFILES.expressive);
  assert.equal(loadState(t).site.motionProfile.name, 'expressive');
  setProfile(t, { duration: 0.5, ease: 'sine.out', stagger: 0.05, distance: 12 });
  assert.equal(loadState(t).site.motionProfile.name, 'custom');
  assert.throws(() => setProfile(t, { duration: 'slow' }), (e) => e.code === 'EPROFILE');
  assert.throws(() => setProfile(t, 'wild'), (e) => e.code === 'EPROFILE');
});

test('recordMotion closes a section only on pass or explicit acceptance', () => {
  const t = theme();
  const fail = path.join(t, 'fail.json');
  const pass = path.join(t, 'pass.json');
  fs.writeFileSync(fail, JSON.stringify({ pass: false }));
  fs.writeFileSync(pass, JSON.stringify({ pass: true }));
  assert.throws(() => recordMotion(t, 'home', 1, { presets: ['fade-up'], checkFile: fail }), (e) => e.code === 'EMOTION');
  assert.equal(loadState(t).pages[0].sections[0].status, 'animating');
  recordMotion(t, 'home', 1, { presets: ['fade-up'], checkFile: fail, accepted: true });
  let sec = loadState(t).pages[0].sections[0];
  assert.equal(sec.status, 'done');
  assert.equal(sec.motion.check, 'accepted');
  assert.match(sec.notes, /accepted by developer/);
  recordMotion(t, 'home', 1, { presets: ['fade-up', 'stagger-children'], checkFile: pass });
  sec = loadState(t).pages[0].sections[0];
  assert.equal(sec.motion.check, 'pass');
  assert.deepEqual(sec.motion.presets, ['fade-up', 'stagger-children']);
});

const profileFile = (t) => path.join(t, 'inc/pb-motion-profile.json');
const epro = (e) => e.code === 'EPROFILE';
const good = { duration: 0.5, ease: 'sine.out', stagger: 0.05, distance: 12 };

test('setProfile rejects inherited Object.prototype names and writes nothing', () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const t = theme();
    assert.throws(() => setProfile(t, name), epro, name);
    assert.equal(fs.existsSync(profileFile(t)), false, `${name} wrote a file`);
    assert.equal(loadState(t).site.motionProfile, undefined, `${name} touched state`);
  }
});

test('setProfile rejects out-of-range numbers and unsafe ease strings', () => {
  const bad = [
    { ...good, duration: -1 }, { ...good, stagger: -1 }, { ...good, distance: -1 },
    { ...good, duration: 11 }, { ...good, stagger: 3 }, { ...good, distance: 401 },
    { ...good, ease: '' },
    { ...good, ease: 'power2.out</script><script>alert(1)' },
  ];
  for (const o of bad) {
    const t = theme();
    assert.throws(() => setProfile(t, o), epro, JSON.stringify(o));
    assert.equal(fs.existsSync(profileFile(t)), false);
  }
  const t = theme();
  setProfile(t, { ...good, ease: 'elastic.out(1,0.3)' });
  assert.equal(JSON.parse(fs.readFileSync(profileFile(t), 'utf8')).ease, 'elastic.out(1,0.3)');
});

test('accepting twice does not duplicate the note; a later pass removes it', () => {
  const t = theme();
  const fail = path.join(t, 'fail.json');
  const pass = path.join(t, 'pass.json');
  fs.writeFileSync(fail, JSON.stringify({ pass: false }));
  fs.writeFileSync(pass, JSON.stringify({ pass: true }));
  updateState(t, (s) => { s.pages[0].sections[0].notes = 'hero is tall'; });
  recordMotion(t, 'home', 1, { presets: [], checkFile: fail, accepted: true });
  recordMotion(t, 'home', 1, { presets: [], checkFile: fail, accepted: true });
  assert.equal(loadState(t).pages[0].sections[0].notes, 'hero is tall; motion accepted by developer');
  recordMotion(t, 'home', 1, { presets: [], checkFile: pass });
  assert.equal(loadState(t).pages[0].sections[0].notes, 'hero is tall');
  // sole note: removed entirely, no stray separator
  const t2 = theme();
  const f2 = path.join(t2, 'fail.json');
  const p2 = path.join(t2, 'pass.json');
  fs.writeFileSync(f2, JSON.stringify({ pass: false }));
  fs.writeFileSync(p2, JSON.stringify({ pass: true }));
  recordMotion(t2, 'home', 1, { presets: [], checkFile: f2, accepted: true });
  recordMotion(t2, 'home', 1, { presets: [], checkFile: p2 });
  assert.ok(!loadState(t2).pages[0].sections[0].notes);
});

test('recordMotion reports a missing section as ENOSECTION', () => {
  const t = theme();
  const pass = path.join(t, 'pass.json');
  fs.writeFileSync(pass, JSON.stringify({ pass: true }));
  assert.throws(() => recordMotion(t, 'home', 9, { presets: [], checkFile: pass }), (e) => e.code === 'ENOSECTION');
  assert.throws(() => recordMotion(t, 'nope', 1, { presets: [], checkFile: pass }), (e) => e.code === 'ENOSECTION');
});

test('recordMotion wraps unreadable or malformed check files as EMOTION', () => {
  const t = theme();
  const bad = path.join(t, 'bad.json');
  fs.writeFileSync(bad, '{nope');
  assert.throws(() => recordMotion(t, 'home', 1, { presets: [], checkFile: bad }), (e) => e.code === 'EMOTION' && /cannot read motion check/.test(e.message));
  assert.throws(() => recordMotion(t, 'home', 1, { presets: [], checkFile: path.join(t, 'missing.json') }), (e) => e.code === 'EMOTION' && /cannot read motion check/.test(e.message));
});

test('installMotion writes the default profile only when missing', () => {
  const t = theme();
  fs.writeFileSync(path.join(t, 'functions.php'), '<?php\n');
  installMotion(t);
  assert.deepEqual(JSON.parse(fs.readFileSync(profileFile(t), 'utf8')), PROFILES.subtle);
  setProfile(t, 'bold');
  installMotion(t);
  assert.deepEqual(JSON.parse(fs.readFileSync(profileFile(t), 'utf8')), PROFILES.bold);
});

const CLI = fileURLToPath(new URL('../../skills/protoblocks-site-builder/scripts/lib/motion.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('CLI: profile, record with flags, bad command and missing --presets value', () => {
  const t = theme();
  let r = cli('profile', t, 'bold');
  assert.equal(r.status, 0);
  assert.equal(loadState(t).site.motionProfile.name, 'bold');
  const fail = path.join(t, 'fail.json');
  fs.writeFileSync(fail, JSON.stringify({ pass: false }));
  r = cli('record', t, 'home', '1', fail, '--presets', 'fade-up,stagger-children', '--accepted');
  assert.equal(r.status, 0, r.stderr);
  const sec = loadState(t).pages[0].sections[0];
  assert.deepEqual(sec.motion.presets, ['fade-up', 'stagger-children']);
  assert.equal(sec.motion.check, 'accepted');
  r = cli('bogus', t);
  assert.equal(r.status, 64);
  assert.match(r.stderr, /Usage/);
  r = cli('record', t, 'home', '1', fail, '--presets');
  assert.equal(r.status, 64);
  assert.match(r.stderr, /Usage/);
});
