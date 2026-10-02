#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState, updateState, DEFAULT_QA } from './state.mjs';
import { artifactsDir } from './intake.mjs';
import { assertSlug } from './slugs.mjs';

export const STANDARD_WIDTHS = { desktop: 1440, tablet: 834, mobile: 390 };

const SAFE_ANCHOR = /^[A-Za-z][A-Za-z0-9_-]*$/; // same rule as check-section
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const fail = (code, message) => Object.assign(new Error(message), { code });

function checkArgs(slug, n) {
  assertSlug(slug, 'page slug');
  const num = typeof n === 'string' && /^[0-9]+$/.test(n) ? Number(n) : n;
  if (!Number.isInteger(num) || num <= 0) throw fail('EINPUT', `Section number must be a positive integer, got ${JSON.stringify(n)}`);
  return num;
}

// realpath of the deepest existing ancestor plus the not-yet-existing tail, so symlinks can't smuggle a path out.
function resolveReal(p) {
  const tail = [];
  let cur = path.resolve(p);
  while (!fs.existsSync(cur)) { tail.unshift(path.basename(cur)); const up = path.dirname(cur); if (up === cur) break; cur = up; }
  return path.join(fs.realpathSync(cur), ...tail);
}
const isInside = (root, target) => target === root || target.startsWith(root + path.sep);
function assertInside(root, target, code, what) {
  if (!isInside(resolveReal(root), resolveReal(target))) throw fail(code, `${what} escapes ${root}: ${target}`);
}

const findSection = (state, slug, n) => {
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No page "${slug}" in state.`);
  const section = page.sections.find((s) => s.n === n);
  if (!section) throw new Error(`No section ${n} on page "${slug}".`);
  if (typeof section.anchor !== 'string' || !SAFE_ANCHOR.test(section.anchor)) throw fail('EINPUT', `Section ${n} has an unsafe anchor ${JSON.stringify(section.anchor)}`);
  return { page, section };
};

const sectionDir = (themeDir, slug, anchor) => path.join(artifactsDir(themeDir), slug, anchor);

function build(state, themeDir, slug, n, minIteration = 1) {
  const { page, section } = findSection(state, slug, n);
  if (!page.url) throw new Error(`Page "${slug}" has no URL yet — run page.mjs build first.`);
  if (!section.crops || !Object.keys(section.crops).length) throw new Error(`Section ${n} has no design crops — run intake.mjs crop first.`);
  const qa = { ...DEFAULT_QA, ...(state.site.qa ?? {}) };
  const frames = page.design?.frames ?? [];
  const breakpoints = [];
  for (const f of frames) {
    if (section.crops[f.breakpoint]) breakpoints.push({ name: f.breakpoint, width: f.width, scale: f.scale, design: section.crops[f.breakpoint], masks: section.masks?.[f.breakpoint] ?? [] });
  }
  for (const [name, width] of Object.entries(STANDARD_WIDTHS)) {
    if (!breakpoints.some((b) => b.name === name)) breakpoints.push({ name, width, sanityOnly: true });
  }
  const iteration = Math.max(minIteration, 1 + Math.max(0, ...(section.qa ?? []).map((q) => q.iteration ?? 0)));
  const iterDir = path.join(sectionDir(themeDir, slug, section.anchor), `iter-${iteration}`);
  assertInside(artifactsDir(themeDir), iterDir, 'EINPUT', 'iterDir');
  return {
    url: page.url,
    anchor: section.anchor,
    iterDir,
    qa: { mismatchMax: qa.mismatchMax, heightDeltaMax: qa.heightDeltaMax },
    breakpoints,
  };
}

export function buildCheckInput(state, themeDir, slug, n) {
  return build(state, themeDir, slug, checkArgs(slug, n));
}

export function prepareCheck(themeDir, slug, n) {
  const num = checkArgs(slug, n);
  const state = loadState(themeDir);
  const { section: current } = findSection(state, slug, num);
  if (current.status === 'planned') throw fail('EINPUT', `Section ${num} on "${slug}" is still planned: build it first (block, attrs, status building, page.mjs build), then verify.`);
  if (current.status === 'skipped') throw fail('EINPUT', `Section ${num} on "${slug}" was skipped by the developer; it is not on the page. Ask before un-skipping it, then build it first.`);
  let input = build(state, themeDir, slug, num);
  let file;
  for (;;) {
    fs.mkdirSync(input.iterDir, { recursive: true });
    file = path.join(input.iterDir, 'input.json');
    try {
      fs.writeFileSync(file, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx' }); // never clobber another run's input
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      input = build(state, themeDir, slug, num, Number(path.basename(input.iterDir).replace('iter-', '')) + 1);
    }
  }
  const iteration = Number(path.basename(input.iterDir).replace('iter-', ''));
  updateState(themeDir, (s) => {
    const { section } = findSection(s, slug, num);
    // Remember where the section came from so a pass can return a finished section to `done`. A section that
    // failed and is being rebuilt keeps the status it had before its first re-verification.
    if (['done', 'animating'].includes(section.status) || section.prevStatus === undefined) section.prevStatus = section.status;
    section.preparedIteration = iteration;
    section.status = 'verifying';
  });
  return { input: file, iteration };
}

export function validateVerdict(v) {
  const errors = [];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['verdict must be a JSON object'];
  if (typeof v.pass !== 'boolean') errors.push('verdict.pass must be boolean');
  if (v.error !== undefined) {
    // error-shaped verdict written by visual-qa when the check script failed
    if (typeof v.error !== 'string' || !v.error) errors.push('verdict.error must be a non-empty string');
    if (v.pass !== false) errors.push('an error verdict must have pass false');
    if (v.numericPass !== false) errors.push('an error verdict must have numericPass false');
    return errors;
  }
  if (typeof v.numericPass !== 'boolean') errors.push('verdict.numericPass must be boolean');
  if (v.discrepancies !== undefined && !Array.isArray(v.discrepancies)) errors.push('verdict.discrepancies must be an array');
  const bps = v.breakpoints;
  if (!Array.isArray(bps) || bps.length === 0) {
    errors.push('verdict.breakpoints must be a non-empty array');
  } else {
    const seen = new Set();
    for (const b of bps) {
      if (typeof b?.name !== 'string' || !SAFE_NAME.test(b.name)) { errors.push(`breakpoint name ${JSON.stringify(b?.name)} is unsafe or missing`); continue; }
      if (seen.has(b.name)) errors.push(`duplicate breakpoint ${b.name}`);
      seen.add(b.name);
      if (!['diff', 'sanity', 'error'].includes(b.mode)) errors.push(`breakpoint ${b.name}: mode must be diff, sanity or error`);
      if (typeof b.numericPass !== 'boolean') errors.push(`breakpoint ${b.name}: numericPass must be boolean`);
    }
  }
  if (v.pass === true) {
    if (v.numericPass !== true) errors.push('pass is true but numericPass is not');
    if ((v.discrepancies ?? []).some((d) => d?.severity === 'high')) errors.push('pass is true but a high-severity discrepancy exists');
    if (Array.isArray(bps) && bps.some((b) => b?.numericPass !== true)) errors.push('pass is true but a breakpoint failed its numeric checks');
  }
  return errors;
}

const everdict = (message) => fail('EVERDICT', message);

function verdictIteration(themeDir, slug, anchor, verdictFile) {
  let real;
  try { real = fs.realpathSync(verdictFile); } catch { throw everdict(`Verdict file not readable: ${verdictFile}`); }
  const iterDir = path.dirname(real);
  const m = /^iter-([1-9][0-9]*)$/.exec(path.basename(iterDir));
  if (!m || path.dirname(iterDir) !== resolveReal(sectionDir(themeDir, slug, anchor))) {
    throw everdict(`Verdict ${verdictFile} is not inside ${sectionDir(themeDir, slug, anchor)}/iter-<k>/`);
  }
  return { real, iterDir, iteration: Number(m[1]) };
}

const readJson = (file, what) => {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw everdict(`${what} ${file} is not readable: ${e.message}`);
  }
  try { return JSON.parse(text); } catch (e) { throw everdict(`${what} ${file} is not valid JSON: ${e.message}`); }
};
const EPS = 1e-9;
const sameNum = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= EPS;

/**
 * The verdict is written by the visual-qa subagent; result.json and input.json are written by the scripts. Never trust
 * the verdict's numbers: they must equal what check-section measured, for the breakpoints prepare asked for, and the
 * pass rule is re-applied with the thresholds from state (not from input.json).
 */
function crossCheck(verdict, iterDir, anchor, qa) {
  const errors = [];
  const result = readJson(path.join(iterDir, 'result.json'), 'Check result');
  if (result === undefined) return [`${path.join(iterDir, 'result.json')} is missing: check-section did not run for this iteration (run it, then let visual-qa judge its output)`];
  const input = readJson(path.join(iterDir, 'input.json'), 'Check input');
  if (input === undefined) return [`${path.join(iterDir, 'input.json')} is missing: run qa-input.mjs prepare`];
  if (!result || typeof result !== 'object' || !Array.isArray(result.results)) return ['result.json has no results list'];
  if (result.anchor !== anchor) errors.push(`result.json is for anchor ${JSON.stringify(result.anchor)}, not the section anchor ${anchor}`);
  if (verdict.numericPass !== result.numericPass) errors.push(`verdict numericPass ${verdict.numericPass} but check-section measured numericPass ${result.numericPass}`);
  const want = (Array.isArray(input?.breakpoints) ? input.breakpoints : []).map((b) => b?.name).sort();
  const got = verdict.breakpoints.map((b) => b.name).sort();
  if (JSON.stringify(want) !== JSON.stringify(got)) errors.push(`verdict breakpoints [${got.join(', ')}] differ from the prepared breakpoints [${want.join(', ')}]`);
  for (const b of verdict.breakpoints) {
    const r = result.results.find((x) => x?.breakpoint === b.name);
    if (!r) { errors.push(`breakpoint ${b.name}: not in result.json`); continue; }
    if (r.mode !== b.mode) errors.push(`breakpoint ${b.name}: mode ${b.mode} but check-section ran ${r.mode}`);
    if (r.numericPass !== b.numericPass) errors.push(`breakpoint ${b.name}: numericPass ${b.numericPass} but check-section measured ${r.numericPass}`);
    for (const key of ['mismatch', 'heightDelta']) {
      if ((r[key] !== undefined || b[key] !== undefined) && !sameNum(b[key], r[key])) errors.push(`breakpoint ${b.name}: ${key} ${JSON.stringify(b[key] ?? null)} but check-section measured ${JSON.stringify(r[key] ?? null)}`);
    }
    if (b.widthDelta !== undefined && !sameNum(b.widthDelta, r.widthDelta)) errors.push(`breakpoint ${b.name}: widthDelta ${JSON.stringify(b.widthDelta)} but check-section measured ${JSON.stringify(r.widthDelta ?? null)}`);
  }
  if (verdict.pass === true) {
    if (result.numericPass !== true) errors.push('pass is true but check-section reported numericPass false');
    for (const r of result.results) {
      if (r?.numericPass !== true) errors.push(`pass is true but breakpoint ${r?.breakpoint} failed its numeric checks`);
      if (r?.mode !== 'diff') continue;
      if (r.fullyMasked) errors.push(`pass is true but breakpoint ${r.breakpoint} was fully masked (nothing compared)`);
      if (!(r.mismatch <= qa.mismatchMax)) errors.push(`pass is true but breakpoint ${r.breakpoint} has mismatch ${r.mismatch} > ${qa.mismatchMax} (site.qa)`);
      if (!(r.heightDelta <= qa.heightDeltaMax)) errors.push(`pass is true but breakpoint ${r.breakpoint} has heightDelta ${r.heightDelta} > ${qa.heightDeltaMax} (site.qa)`);
    }
  }
  return errors;
}

export function recordVerdict(themeDir, slug, n, verdictFile) {
  const num = checkArgs(slug, n);
  const state = loadState(themeDir);
  const { section: sec } = findSection(state, slug, num);
  const { real, iterDir, iteration } = verdictIteration(themeDir, slug, sec.anchor, verdictFile);
  if (sec.preparedIteration === undefined) throw everdict(`Section ${num} has no prepared iteration: run qa-input.mjs prepare first.`);
  if (iteration !== sec.preparedIteration) throw everdict(`Verdict ${verdictFile} is for iteration ${iteration}, but the newest prepared iteration is ${sec.preparedIteration}; record only the newest one (re-dispatch visual-qa for iter-${sec.preparedIteration}).`);
  let verdict;
  try { verdict = JSON.parse(fs.readFileSync(real, 'utf8')); } catch (e) { throw everdict(`Verdict ${verdictFile} is not valid JSON: ${e.message}`); }
  const errors = validateVerdict(verdict);
  if (verdict?.anchor !== undefined && verdict.anchor !== null && verdict.anchor !== sec.anchor) errors.push(`verdict anchor ${JSON.stringify(verdict.anchor)} does not match section anchor ${sec.anchor}`);
  if (!errors.length && verdict.error === undefined) errors.push(...crossCheck(verdict, iterDir, sec.anchor, { ...DEFAULT_QA, ...(state.site.qa ?? {}) }));
  if (errors.length) throw everdict(`Inconsistent verdict ${verdictFile}:\n- ${errors.join('\n- ')}`);
  const isError = verdict.error !== undefined;
  let result;
  updateState(themeDir, (s) => {
    const { page, section } = findSection(s, slug, num);
    section.qa ??= [];
    if (isError) {
      section.qa.push({ iteration, breakpoint: null, mode: 'error', status: 'error', pass: false, error: verdict.error, verdict: verdictFile });
    }
    for (const b of verdict.breakpoints ?? []) {
      section.qa.push({
        iteration, breakpoint: b.name, mode: b.mode,
        ...(b.mode === 'diff' ? { mismatch: b.mismatch, heightDelta: b.heightDelta } : {}),
        ...(b.widthDelta !== undefined ? { widthDelta: b.widthDelta } : {}),
        numericPass: b.numericPass,
        ...(b.status !== undefined ? { status: b.status } : {}),
        pass: verdict.pass, verdict: verdictFile,
      });
    }
    if (verdict.pass) {
      // A section that was finished before this re-verification (e.g. after the header moved into its part, or a
      // shared-block edit) goes back to done; motion already ran for it.
      section.status = section.prevStatus === 'done' ? 'done' : 'animating';
      delete section.prevStatus;
      const lib = s.library[section.block] ??= { usedOn: [] };
      lib.baselines ??= [];
      for (const b of verdict.breakpoints.filter((x) => x.mode === 'diff')) {
        const src = path.join(iterDir, `${b.name}-render.png`);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(artifactsDir(themeDir), 'baselines', slug, `${section.anchor}-${b.name}.png`);
        assertInside(artifactsDir(themeDir), dest, 'EVERDICT', 'baseline path');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        const frame = (page.design?.frames ?? []).find((f) => f.breakpoint === b.name) ?? {};
        lib.baselines = lib.baselines.filter((x) => !(x.page === slug && x.anchor === section.anchor && x.breakpoint === b.name));
        lib.baselines.push({ page: slug, anchor: section.anchor, breakpoint: b.name, file: dest, width: frame.width ?? STANDARD_WIDTHS[b.name], scale: frame.scale ?? 1 });
      }
    } else if (!isError) {
      section.status = 'building'; // a script/environment error keeps 'verifying': re-run the check, don't rebuild
    }
    const max = s.site.qa?.maxIterations ?? DEFAULT_QA.maxIterations;
    // Attempts = distinct failed iterations since the last pass that were real checks; script-error iterations can't be fixed by editing the block.
    const errorIters = new Set(section.qa.filter((q) => q.status === 'error' && q.mode === 'error').map((q) => q.iteration));
    // The budget restarts after a passing iteration (e.g. re-verifying after a shared block edit).
    const lastPass = Math.max(0, ...section.qa.filter((q) => q.pass === true).map((q) => q.iteration));
    const failedIters = new Set(section.qa.filter((q) => q.pass === false && q.iteration > lastPass && !errorIters.has(q.iteration)).map((q) => q.iteration));
    const capReached = !verdict.pass && !isError && failedIters.size >= max;
    // Persist it: a resumed session must ask the developer before another iteration (verify.md, "Iteration cap").
    if (capReached) for (const q of section.qa) if (q.iteration === iteration) q.capReached = true;
    result = { pass: verdict.pass, iteration, capReached, status: section.status };
  });
  return result;
}

function main(argv) {
  const [cmd, themeDir, slug, n, file] = argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'prepare' && themeDir && slug && n) return out(prepareCheck(themeDir, slug, n));
  if (cmd === 'record' && themeDir && slug && n && file) return out(recordVerdict(themeDir, slug, n, file));
  process.stderr.write('Usage: node qa-input.mjs prepare <themeDir> <slug> <n> | record <themeDir> <slug> <n> <verdict.json>\n');
  process.exit(64);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
