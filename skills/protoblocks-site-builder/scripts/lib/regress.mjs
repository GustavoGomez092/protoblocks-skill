#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState } from './state.mjs';

export const REGRESSION = { mismatchMax: 0.01, heightDeltaMax: 0.005 };
const SAFE_ANCHOR = /^[A-Za-z][A-Za-z0-9_-]*$/; // same rule as check-section

export async function regress(themeDir, block, { browser } = {}) {
  const state = loadState(themeDir);
  const baselines = state.library[block]?.baselines ?? [];
  const results = [];
  if (baselines.length) {
    const { shoot } = await import('../qa/shoot.mjs');
    const { diffImages } = await import('../qa/diff.mjs');
    const { launchBrowser } = await import('../qa/browser.mjs');
    const own = !browser;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-regress-'));
    let b = browser;
    try {
      b ??= await launchBrowser();
      for (const base of baselines) {
        const id = { page: base.page, anchor: base.anchor, breakpoint: base.breakpoint };
        const failed = (error) => results.push({ ...id, pass: false, error });
        const page = state.pages.find((p) => p.slug === base.page);
        if (!page?.url) { failed('page has no url'); continue; }
        if (typeof base.anchor !== 'string' || !SAFE_ANCHOR.test(base.anchor)) { failed(`invalid anchor ${JSON.stringify(base.anchor)}`); continue; }
        if (!base.file || !fs.existsSync(base.file)) { failed(`baseline file missing: ${base.file}`); continue; }
        try {
          const out = path.join(tmp, `${results.length}.png`);
          await shoot({ url: page.url, selector: `#${base.anchor}`, width: base.width, scale: base.scale, out, browser: b });
          const d = await diffImages({ design: base.file, render: out });
          results.push({ ...id, mismatch: d.mismatch, heightDelta: d.heightDelta, pass: d.mismatch <= REGRESSION.mismatchMax && d.heightDelta <= REGRESSION.heightDeltaMax });
        } catch (e) {
          failed(`${e.code ? `[${e.code}] ` : ''}${e.message}`);
        }
      }
    } catch (e) {
      // browser launch failure: every baseline not yet reported fails with the reason
      for (const base of baselines.slice(results.length)) results.push({ page: base.page, anchor: base.anchor, breakpoint: base.breakpoint, pass: false, error: `${e.code ? `[${e.code}] ` : ''}${e.message}` });
    } finally {
      if (own && b) await b.close().catch(() => {});
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { block, results, pass: results.every((r) => r.pass) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [themeDir, block] = process.argv.slice(2);
  if (!themeDir || !block) { process.stderr.write('Usage: node regress.mjs <themeDir> <block>\n'); process.exit(64); }
  regress(themeDir, block).then((r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); if (!r.pass) process.exit(1); })
    .catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
