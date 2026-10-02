#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

export async function shoot({ url, selector, width, height = 900, scale = 1, reducedMotion = true, fullPage = false, out, browser }) {
  const own = !browser;
  const b = browser ?? await launchBrowser();
  try {
    const { page, context, errors } = await openPage(b, { url, width, height, scale, reducedMotion });
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      let box = null;
      if (selector) {
        const loc = page.locator(selector).first();
        if (await loc.count() === 0) {
          const e = new Error(`Selector ${selector} not found on ${url}`);
          e.code = 'ENOSELECTOR';
          throw e;
        }
        await loc.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await loc.screenshot({ path: out });
        box = await loc.boundingBox();
      } else {
        await page.screenshot({ path: out, fullPage });
      }
      return { out, url, selector: selector ?? null, width, scale, box, consoleErrors: errors.console, pageErrors: errors.page };
    } finally {
      await context.close();
    }
  } finally {
    if (own) await b.close();
  }
}

async function main(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--full-page' || argv[i] === '--motion') a.flags.add(argv[i]);
    else a[argv[i].replace(/^--/, '')] = argv[++i];
  }
  if (!a.url || !a.width || !a.out) { process.stderr.write('Usage: node shoot.mjs --url U --width W --out F [--selector S] [--scale 2] [--full-page] [--motion]\n'); process.exit(64); }
  const r = await shoot({ url: a.url, selector: a.selector, width: Number(a.width), scale: a.scale ? Number(a.scale) : 1, fullPage: a.flags.has('--full-page'), reducedMotion: !a.flags.has('--motion'), out: a.out });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
