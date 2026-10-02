#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser.mjs';
import { shoot } from './shoot.mjs';
import { diffImages } from './diff.mjs';
import { sanity } from './sanity.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('EINPUT', 'input must be a JSON object');
  const { anchor, qa, breakpoints, imageWaitMs } = input;
  if (imageWaitMs !== undefined && (!isNum(imageWaitMs) || imageWaitMs < 0)) throw fail('EINPUT', 'imageWaitMs must be a non-negative number');
  if (typeof anchor !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(anchor)) {
    throw fail('EANCHOR', `Invalid anchor ${JSON.stringify(anchor)}: must match /^[A-Za-z][A-Za-z0-9_-]*$/`);
  }
  if (!Array.isArray(breakpoints) || breakpoints.length === 0) throw fail('EINPUT', 'breakpoints must be a non-empty array');
  if (!qa || !isNum(qa.mismatchMax) || !isNum(qa.heightDeltaMax)) throw fail('EINPUT', 'qa.mismatchMax and qa.heightDeltaMax must be numbers');
  const seen = new Set();
  for (const bp of breakpoints) {
    if (!bp || typeof bp.name !== 'string' || !bp.name) throw fail('EINPUT', 'every breakpoint needs a name');
    if (!/^[A-Za-z0-9_-]+$/.test(bp.name)) throw fail('EINPUT', `Breakpoint name ${JSON.stringify(bp.name)} is unsafe for file names (allowed: A-Z a-z 0-9 _ -)`);
    if (seen.has(bp.name)) throw fail('EINPUT', `Duplicate breakpoint name ${JSON.stringify(bp.name)} (output files would overwrite each other)`);
    seen.add(bp.name);
    if (!isNum(bp.width) || bp.width <= 0) throw fail('EINPUT', `Breakpoint ${bp.name} needs a positive numeric width`);
    if (!bp.sanityOnly && bp.design && !fs.existsSync(bp.design)) throw fail('EINPUT', `Design file for breakpoint ${bp.name} does not exist: ${bp.design}`);
  }
}

export async function checkSection(input) {
  validate(input);
  const { url, anchor, iterDir, qa, breakpoints, imageWaitMs } = input;
  fs.mkdirSync(iterDir, { recursive: true });
  const selector = `#${anchor}`;
  const browser = await launchBrowser();
  const results = [];
  try {
    for (const bp of breakpoints) {
      const render = path.join(iterDir, `${bp.name}-render.png`);
      try {
        const shot = await shoot({ url, selector, width: bp.width, scale: bp.scale ?? 1, out: render, browser, imageWaitMs });
        const clean = shot.pageErrors.length === 0 && shot.imageErrors.length === 0;
        if (bp.sanityOnly || !bp.design) {
          const s = await sanity({ url, selector, width: bp.width, browser, imageWaitMs });
          results.push({ breakpoint: bp.name, mode: 'sanity', ok: s.ok, issues: s.issues, render, consoleErrors: shot.consoleErrors, pageErrors: shot.pageErrors, imageErrors: shot.imageErrors });
          continue;
        }
        const d = await diffImages({ design: bp.design, render, out: path.join(iterDir, `${bp.name}-composite.png`), masks: bp.masks ?? [] });
        const numericPass = !d.fullyMasked && d.mismatch <= qa.mismatchMax && d.heightDelta <= qa.heightDeltaMax && clean;
        results.push({ breakpoint: bp.name, mode: 'diff', mismatch: d.mismatch, heightDelta: d.heightDelta, fullyMasked: !!d.fullyMasked, numericPass, render, composite: d.composite, consoleErrors: shot.consoleErrors, pageErrors: shot.pageErrors, imageErrors: shot.imageErrors });
      } catch (e) {
        results.push({ breakpoint: bp.name, mode: 'error', error: `${e.code ? `[${e.code}] ` : ''}${e.message}`, numericPass: false });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  // sanity issues never flip numericPass (the subagent judges them); page/image errors do
  const numericPass = results.every((r) => (r.mode === 'diff' ? r.numericPass : r.mode === 'sanity' ? r.pageErrors.length === 0 && r.imageErrors.length === 0 : false));
  const out = { anchor, url, numericPass, results };
  fs.writeFileSync(path.join(iterDir, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) { process.stderr.write('Usage: node check-section.mjs <input.json>\n'); process.exit(64); }
  let input;
  try { input = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    process.stderr.write(`Cannot read input ${file}: ${e.code === 'ENOENT' ? 'file not found' : e.message.split('\n')[0]}\n`);
    process.exit(1);
  }
  checkSection(input)
    .then((r) => process.stdout.write(`${JSON.stringify(r, null, 2)}\n`))
    .catch((e) => { process.stderr.write(`${(e.code ? `[${e.code}] ` : '') + e.message.split('\n')[0]}\n`); process.exit(1); });
}
