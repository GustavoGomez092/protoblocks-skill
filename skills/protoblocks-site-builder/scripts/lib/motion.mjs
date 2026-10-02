#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { updateState, statePath } from './state.mjs';
import { installThemeAssets, DEFAULT_ASSETS_DIR } from './theme-assets.mjs';

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

// Default attempt cap when site.qa.maxIterations is not set.
export const MAX_ATTEMPTS = 3;

// The preset names the shipped runtime knows (its REVEAL and CONTINUOUS lists), read from pb-motion.js itself.
export function runtimePresets(file = path.join(DEFAULT_ASSETS_DIR, 'assets', 'js', 'pb-motion.js')) {
  const src = fs.readFileSync(file, 'utf8');
  const list = (name) => [...(src.match(new RegExp(`var ${name} = \\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return [...list('REVEAL'), ...list('CONTINUOUS')];
}

// Same page: origin and path (trailing slash ignored); query and fragment do not make another page.
const pageKey = (u) => { try { const x = new URL(u); return `${x.origin}${x.pathname.replace(/\/+$/, '')}`; } catch { return String(u); } };

// The check must be a result for this section: its anchor, and the page URL when state knows it. A stale or foreign
// motion-check.json is refused before anything is counted.
function assertCheckFor(check, page, sec, checkFile) {
  if (check.anchor !== sec.anchor) throw fail(`${checkFile} is a motion check of anchor "${check.anchor}", not "${sec.anchor}" (section ${sec.n} on "${page.slug}"); re-run the check for this section.`, 'EMOTION');
  if (page.url && pageKey(check.url) !== pageKey(page.url)) throw fail(`${checkFile} is a motion check of url "${check.url}", not this page's url "${page.url}"; re-run the check for this page.`, 'EMOTION');
}

// A failing check (not accepted) is persisted as an attempt on the section (check "fail"), in its own state write,
// then reported as EMOTION with the count; e.result carries { pass, attempts, capReached, status }. A pass or an
// acceptance replaces section.motion, which resets the count. The cap is site.qa.maxIterations (default 3).
// Closing a section needs status "animating"; only an explicit acceptance may close it from another status.
export function recordMotion(themeDir, slug, n, { presets = [], checkFile, accepted = false }) {
  const known = runtimePresets();
  const unknown = presets.filter((p) => !known.includes(p));
  if (unknown.length) throw fail(`Unknown preset(s) ${unknown.join(', ')}; pb-motion presets: ${known.join(', ')}.`, 'EMOTION');
  let check;
  try { check = JSON.parse(fs.readFileSync(checkFile, 'utf8')); } catch (e) { throw fail(`cannot read motion check ${checkFile}: ${e.message}`, 'EMOTION'); }
  const passed = check.pass === true;
  const find = (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    const sec = page?.sections.find((x) => x.n === Number(n));
    if (!sec) throw fail(`No section ${n} on page "${slug}".`, 'ENOSECTION');
    if (sec.status !== 'animating' && !accepted) throw fail(`Section ${n} on "${slug}" has status "${sec.status}", not "animating"; motion is recorded only while animating.`, 'ESTATUS');
    assertCheckFor(check, page, sec, checkFile);
    return sec;
  };
  const capOf = (s) => s.site.qa?.maxIterations ?? MAX_ATTEMPTS;
  if (!passed && !accepted) {
    let attempts;
    let cap;
    updateState(themeDir, (s) => {
      const sec = find(s);
      attempts = (sec.motion?.attempts ?? 0) + 1;
      cap = capOf(s);
      sec.motion = { ...(sec.motion ?? {}), check: 'fail', attempts, lastResult: checkFile };
    });
    const capReached = attempts >= cap;
    const e = fail(`Motion check did not pass (${checkFile}); attempts: ${attempts}, capReached: ${capReached}.${capReached ? ' Stop and ask the developer: simplify, accept (--accepted) or remove the motion.' : ' Fix the motion and re-run the check.'}`, 'EMOTION');
    e.attempts = attempts;
    e.capReached = capReached;
    e.result = { pass: false, attempts, capReached, status: 'animating' };
    throw e;
  }
  let result;
  updateState(themeDir, (s) => {
    const sec = find(s);
    const attempts = (sec.motion?.attempts ?? 0) + 1;
    sec.motion = { presets, check: passed ? 'pass' : 'accepted', result: checkFile };
    const parts = (sec.notes ? String(sec.notes).split('; ') : []).filter((x) => x && x !== NOTE);
    if (!passed) parts.push(NOTE);
    if (parts.length) sec.notes = parts.join('; '); else delete sec.notes;
    sec.status = 'done';
    result = { pass: passed, attempts, capReached: false, status: sec.status };
  });
  return result;
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
  try { main(process.argv.slice(2)); } catch (e) {
    // A failed check still prints its result JSON on stdout (same shape as a pass), plus the one-line reason on stderr.
    if (e.result) process.stdout.write(`${JSON.stringify(e.result, null, 2)}\n`);
    process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${String(e.message).replace(/\n/g, ' ')}\n`);
    process.exit(1);
  }
}
