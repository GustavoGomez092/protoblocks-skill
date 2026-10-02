#!/usr/bin/env node
// Records the developer-approved section plan for one page (the plan gate), in one atomic, validated write.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { updateState } from './state.mjs';
import { assertSlug, isSlug } from './slugs.mjs';

// Header and footer render from the theme's template parts on every page, so they get fixed anchors instead of
// pb-s<n>: the part keeps one id site-wide, and a later page's own pb-s<n> can never collide with it.
export const PART_ANCHORS = Object.freeze({ header: 'pb-header', footer: 'pb-footer' });
const DECISIONS = ['new', 'reuse', 'extend'];
const USAGE = 'Usage: node plan.mjs record <themeDir> <plan.json>\n';

const fail = (code, message) => Object.assign(new Error(message), { code });
const isBlock = (b) => typeof b === 'string' && b.split('/').length <= 2 && b.split('/').every(isSlug);

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw fail('EPLAN', 'The plan must be a JSON object {page, sections: [...]}.');
  assertSlug(plan.page, 'page slug');
  if (!Array.isArray(plan.sections)) throw fail('EPLAN', 'plan.sections must be a list.');
  const seenN = new Set();
  const seenPart = new Set();
  for (const p of plan.sections) {
    const at = `section ${JSON.stringify(p?.n ?? null)}`;
    if (!p || !Number.isInteger(p.n) || p.n <= 0) throw fail('EPLAN', `${at}: n must be a positive integer.`);
    if (seenN.has(p.n)) throw fail('EPLAN', `${at} is listed twice.`);
    seenN.add(p.n);
    if (!DECISIONS.includes(p.decision)) throw fail('EPLAN', `${at}: decision must be one of ${DECISIONS.join(', ')}.`);
    if (!isBlock(p.block)) throw fail('EPLAN', `${at}: block must be a slug like "hero-split" (got ${JSON.stringify(p.block ?? null)}).`);
    if (typeof p.label !== 'string' || !p.label) throw fail('EPLAN', `${at}: label is required.`);
    if (p.notes !== undefined && typeof p.notes !== 'string') throw fail('EPLAN', `${at}: notes must be a string.`);
    if (p.part !== undefined) {
      if (!Object.hasOwn(PART_ANCHORS, p.part)) throw fail('EPLAN', `${at}: part must be "header" or "footer".`);
      if (seenPart.has(p.part)) throw fail('EPLAN', `Only one section can be the ${p.part}.`);
      seenPart.add(p.part);
    }
  }
}

/**
 * Looks the page up by slug and each section by n. Header/footer (`part`) get the fixed anchors. When another page
 * already has that part in a template part (`inPart`), this page's copy is `reuse` + `inPart: true` + status
 * `building`: nothing to build, `page.mjs` leaves it out, and it is verified through the part's anchor.
 */
export function recordPlan(themeDir, plan) {
  validatePlan(plan);
  let recorded;
  updateState(themeDir, (s) => {
    const page = s.pages.find((p) => p.slug === plan.page);
    if (!page) throw fail('ENOPAGE', `No page "${plan.page}" in state (add a frame first).`);
    for (const p of plan.sections) {
      const sec = page.sections.find((x) => x.n === p.n);
      if (!sec) throw fail('ENOSECTION', `No section n=${p.n} on page "${plan.page}" (run intake.mjs crop first).`);
      Object.assign(sec, { label: p.label, decision: p.decision, block: p.block });
      if (p.notes !== undefined) sec.notes = p.notes;
      if (!p.part) continue;
      const anchor = PART_ANCHORS[p.part];
      const clash = page.sections.find((x) => x.n !== p.n && x.anchor === anchor);
      if (clash) throw fail('EPLAN', `Section ${clash.n} on "${plan.page}" already has the anchor ${anchor}; only one ${p.part} per page.`);
      if (sec.anchor !== anchor && (sec.qa ?? []).length) throw fail('EPLAN', `Section ${p.n} was already verified as #${sec.anchor}; it cannot become the ${p.part} now.`);
      sec.anchor = anchor;
      const inPartElsewhere = s.pages.some((o) => o.slug !== page.slug && o.sections.some((x) => x.anchor === anchor && x.inPart === true));
      if (inPartElsewhere) {
        if (p.decision !== 'reuse') {
          throw fail('EPLAN', `The ${p.part} already renders from the theme's template part (built on another page), so on "${plan.page}" it must be planned as "reuse". To change it, follow "Editing the header later" in protoblocks-section-loop references/header-footer.md.`);
        }
        sec.inPart = true;
        if (sec.status === 'planned') sec.status = 'building';
      }
    }
    page.plan = { approvedAt: new Date().toISOString(), by: 'developer' };
    page.status = 'building';
    recorded = {
      page: page.slug,
      sections: plan.sections.map((p) => {
        const x = page.sections.find((y) => y.n === p.n);
        return { n: x.n, anchor: x.anchor, label: x.label, decision: x.decision, block: x.block, inPart: x.inPart === true, status: x.status };
      }),
    };
  });
  return recorded;
}

function main(argv) {
  const [cmd, themeDir, file] = argv;
  if (cmd !== 'record' || !themeDir || !file || argv.length !== 3) { process.stderr.write(USAGE); process.exit(64); }
  let plan;
  try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw fail('EPLAN', `Cannot read plan ${file}: ${e.message}`); }
  process.stdout.write(`${JSON.stringify(recordPlan(themeDir, plan), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
