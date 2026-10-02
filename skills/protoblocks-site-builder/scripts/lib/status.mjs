#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadState, statePath } from './state.mjs';

const CLOSED = new Set(['done', 'skipped']);
// Every action nextAction can return. The orchestrator SKILL.md has one action-table row per entry (tested).
export const ACTIONS = Object.freeze(['setup', 'breakdown', 'build-page', 'section-build', 'section-verify', 'section-animate', 'page-qa', 'seo', 'ask-more-pages']);

export function nextAction(state) {
  if (!state) return { action: 'setup', why: 'no build state yet' };
  const page = state.pages.find((p) => p.status !== 'done');
  if (!page) return { action: 'ask-more-pages', why: state.pages.length ? 'every page is done' : 'no pages yet' };
  if (page.status === 'planning') {
    if (page.plan?.approvedAt && !page.sections.length) return { action: 'breakdown', page: page.slug, why: 'approved plan has no sections' };
    return page.plan?.approvedAt
      ? { action: 'build-page', page: page.slug, why: 'plan approved; start building' }
      : { action: 'breakdown', page: page.slug, why: 'section plan not approved yet' };
  }
  if (page.status === 'seo') return { action: 'seo', page: page.slug, why: 'page QA passed' };
  if (!page.sections.length) return { action: 'breakdown', page: page.slug, why: 'building page has no sections' };
  const open = [...page.sections].sort((a, b) => a.n - b.n).find((s) => !CLOSED.has(s.status));
  if (open) {
    const action = open.status === 'verifying' ? 'section-verify' : open.status === 'animating' ? 'section-animate' : 'section-build';
    return { action, page: page.slug, section: open.n, why: `section ${open.n} is ${open.status}` };
  }
  return page.pageQa?.pass
    ? { action: 'seo', page: page.slug, why: 'page QA passed' }
    : { action: 'page-qa', page: page.slug, why: 'all sections closed' };
}

export function summarize(state) {
  return {
    site: { url: state.site.url, theme: state.site.theme?.slug ?? null },
    pages: state.pages.map((p) => ({
      slug: p.slug,
      status: p.status,
      sections: [...p.sections].sort((a, b) => a.n - b.n).map((s) => {
        const qa = (s.qa ?? []).filter((q) => q?.iteration != null);
        const iterations = new Set(qa.map((q) => q.iteration)).size;
        const last = qa.at(-1);
        return { n: s.n, label: s.label ?? null, block: s.block ?? null, status: s.status, iterations, lastPass: last ? last.pass === true : null };
      }),
    })),
    next: nextAction(state),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const themeDir = process.argv[2];
  if (!themeDir) { process.stderr.write('Usage: node status.mjs <themeDir>\n'); process.exit(64); }
  try {
    if (!fs.existsSync(themeDir) || !fs.statSync(themeDir).isDirectory()) {
      process.stderr.write(`[ENOTHEME] ${themeDir} is not a directory\n`); process.exit(1);
    }
    const out = fs.existsSync(statePath(themeDir)) ? summarize(loadState(themeDir)) : { next: nextAction(null) };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } catch (e) { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); }
}
