import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROFILES, setProfile, recordMotion } from '../../skills/protoblocks-site-builder/scripts/lib/motion.mjs';
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
