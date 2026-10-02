#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, statePath } from './state.mjs';
import { installThemeAssets } from './theme-assets.mjs';

export const PROFILES = Object.freeze({
  subtle: { duration: 0.7, ease: 'power2.out', stagger: 0.08, distance: 24 },
  expressive: { duration: 0.9, ease: 'power3.out', stagger: 0.1, distance: 40 },
  bold: { duration: 1.1, ease: 'expo.out', stagger: 0.12, distance: 64 },
});

const fail = (message, code) => { const e = new Error(message); e.code = code; return e; };

export function setProfile(themeDir, nameOrObject) {
  let name;
  let values;
  if (typeof nameOrObject === 'string') {
    if (!PROFILES[nameOrObject]) throw fail(`Unknown motion profile "${nameOrObject}" (subtle|expressive|bold or a custom object).`, 'EPROFILE');
    name = nameOrObject;
    values = { ...PROFILES[nameOrObject] };
  } else {
    const o = nameOrObject ?? {};
    if (![o.duration, o.stagger, o.distance].every((v) => typeof v === 'number' && Number.isFinite(v)) || typeof o.ease !== 'string') {
      throw fail('Custom profile needs numeric duration, stagger, distance and a string ease.', 'EPROFILE');
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

export function recordMotion(themeDir, slug, n, { presets = [], checkFile, accepted = false }) {
  const check = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
  if (check.pass !== true && !accepted) throw fail(`Motion check did not pass (${checkFile}). Fix the motion or ask the developer to accept.`, 'EMOTION');
  let status;
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === slug);
    const sec = page?.sections.find((x) => x.n === Number(n));
    if (!sec) throw fail(`No section ${n} on page "${slug}".`, 'ENOSECTION');
    sec.motion = { presets, check: check.pass === true ? 'pass' : 'accepted', result: checkFile };
    if (check.pass !== true) sec.notes = [sec.notes, 'motion accepted by developer'].filter(Boolean).join('; ');
    sec.status = 'done';
    status = sec.status;
  });
  return { status };
}

function main(argv) {
  const [cmd, themeDir, a, b, c, ...rest] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'install' && themeDir) return out(installMotion(themeDir));
  if (cmd === 'profile' && themeDir && a) return out(setProfile(themeDir, a.trim().startsWith('{') ? JSON.parse(a) : a));
  if (cmd === 'record' && themeDir && a && b && c) {
    const flags = [...rest];
    const pi = flags.indexOf('--presets');
    return out(recordMotion(themeDir, a, b, { checkFile: c, presets: pi >= 0 ? flags[pi + 1].split(',') : [], accepted: flags.includes('--accepted') }));
  }
  process.stderr.write('Usage: node motion.mjs install <themeDir> | profile <themeDir> <name|json> | record <themeDir> <slug> <n> <check.json> --presets a,b [--accepted]\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
