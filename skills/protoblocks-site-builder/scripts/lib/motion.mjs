#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { updateState, statePath } from './state.mjs';
import { installThemeAssets } from './theme-assets.mjs';

export const PROFILES = Object.freeze({
  subtle: { duration: 0.7, ease: 'power2.out', stagger: 0.08, distance: 24 },
  expressive: { duration: 0.9, ease: 'power3.out', stagger: 0.1, distance: 40 },
  bold: { duration: 1.1, ease: 'expo.out', stagger: 0.12, distance: 64 },
});

const NOTE = 'motion accepted by developer';
const fail = (message, code) => { const e = new Error(message); e.code = code; return e; };

// SECURITY: the PHP that prints this profile must use wp_json_encode with JSON_HEX_TAG|JSON_HEX_AMP.
export function setProfile(themeDir, nameOrObject) {
  let name;
  let values;
  if (typeof nameOrObject === 'string') {
    if (!Object.hasOwn(PROFILES, nameOrObject)) throw fail(`Unknown motion profile "${nameOrObject}" (subtle|expressive|bold or a custom object).`, 'EPROFILE');
    name = nameOrObject;
    values = { ...PROFILES[nameOrObject] };
  } else {
    const o = nameOrObject ?? {};
    const inRange = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
    if (!inRange(o.duration, 10) || !inRange(o.stagger, 2) || !inRange(o.distance, 400) || typeof o.ease !== 'string' || !/^[A-Za-z0-9.(),\- ]{1,40}$/.test(o.ease)) {
      throw fail('Custom profile needs duration 0-10, stagger 0-2, distance 0-400 (numbers) and an ease of 1-40 chars from A-Za-z0-9.(), - .', 'EPROFILE');
    }
    name = 'custom';
    values = { duration: o.duration, ease: o.ease, stagger: o.stagger, distance: o.distance };
  }
  fs.mkdirSync(path.join(themeDir, 'inc'), { recursive: true });
  fs.writeFileSync(path.join(themeDir, 'inc', 'pb-motion-profile.json'), `${JSON.stringify(values, null, 2)}\n`);
  if (fs.existsSync(statePath(themeDir))) updateState(themeDir, (s) => { s.site.motionProfile = { name, ...values }; });
  return { name, ...values };
}

export function installMotion(themeDir) {
  const r = installThemeAssets(themeDir);
  if (!fs.existsSync(path.join(themeDir, 'inc', 'pb-motion-profile.json'))) setProfile(themeDir, 'subtle');
  return r;
}

export const MAX_ATTEMPTS = 3;

// A failing check (not accepted) is persisted as an attempt on the section, in its own state write, then reported
// as EMOTION with the count. A pass or an acceptance replaces section.motion, which resets the count.
// Closing a section needs status "animating"; only an explicit acceptance may close it from another status.
export function recordMotion(themeDir, slug, n, { presets = [], checkFile, accepted = false }) {
  let check;
  try { check = JSON.parse(fs.readFileSync(checkFile, 'utf8')); } catch (e) { throw fail(`cannot read motion check ${checkFile}: ${e.message}`, 'EMOTION'); }
  const passed = check.pass === true;
  const find = (s) => {
    const sec = s.pages.find((p) => p.slug === slug)?.sections.find((x) => x.n === Number(n));
    if (!sec) throw fail(`No section ${n} on page "${slug}".`, 'ENOSECTION');
    if (sec.status !== 'animating' && !accepted) throw fail(`Section ${n} on "${slug}" has status "${sec.status}", not "animating"; motion is recorded only while animating.`, 'ESTATUS');
    return sec;
  };
  if (!passed && !accepted) {
    let attempts;
    updateState(themeDir, (s) => {
      const sec = find(s);
      attempts = (sec.motion?.attempts ?? 0) + 1;
      sec.motion = { ...(sec.motion ?? {}), attempts, lastResult: checkFile };
    });
    const capReached = attempts >= MAX_ATTEMPTS;
    const e = fail(`Motion check did not pass (${checkFile}); attempts: ${attempts}, capReached: ${capReached}.${capReached ? ' Stop and ask the developer: simplify, accept (--accepted) or remove the motion.' : ' Fix the motion and re-run the check.'}`, 'EMOTION');
    e.attempts = attempts;
    e.capReached = capReached;
    throw e;
  }
  let status;
  updateState(themeDir, (s) => {
    const sec = find(s);
    sec.motion = { presets, check: passed ? 'pass' : 'accepted', result: checkFile };
    const parts = (sec.notes ? String(sec.notes).split('; ') : []).filter((x) => x && x !== NOTE);
    if (!passed) parts.push(NOTE);
    if (parts.length) sec.notes = parts.join('; '); else delete sec.notes;
    sec.status = 'done';
    status = sec.status;
  });
  return { status };
}

function usage() {
  process.stderr.write('Usage: node motion.mjs install <themeDir> | profile <themeDir> <name|json> | record <themeDir> <slug> <n> <check.json> --presets a,b [--accepted]\n');
  process.exit(64);
}

function main(argv) {
  const [cmd, themeDir, a, b, c, ...rest] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'install' && themeDir) return out(installMotion(themeDir));
  if (cmd === 'profile' && themeDir && a) return out(setProfile(themeDir, a.trim().startsWith('{') ? JSON.parse(a) : a));
  if (cmd === 'record' && themeDir && a && b && c) {
    const flags = [...rest];
    const pi = flags.indexOf('--presets');
    return out(recordMotion(themeDir, a, b, { checkFile: c, presets: pi >= 0 ? (flags[pi + 1] ?? usage()).split(',') : [], accepted: flags.includes('--accepted') }));
  }
  usage();
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
