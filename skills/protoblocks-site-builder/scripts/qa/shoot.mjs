#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openPage, withDiagnostics } from './browser.mjs';

export async function shoot({ url, selector, width, height = 900, scale = 1, reducedMotion = true, fullPage = false, out, browser, imageWaitMs }) {
  const own = !browser;
  const b = browser ?? await launchBrowser();
  try {
    const { page, context, errors, status } = await openPage(b, { url, width, height, scale, reducedMotion, imageWaitMs });
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      let box = null;
      let imageErrors = errors.images;
      let pageImageWarnings = [];
      if (selector) {
        const loc = page.locator(selector).first();
        if (await loc.count() === 0) {
          const e = new Error(`Selector ${selector} not found on ${url}`);
          e.code = 'ENOSELECTOR';
          throw e;
        }
        await loc.scrollIntoViewIfNeeded();
        // Image problems are scoped to the anchor: broken (404 / undecodable: "complete" with naturalWidth 0) or still
        // pending (stalled) rendered images inside it are errors; pending rendered images elsewhere are only warnings.
        const imgs = await loc.evaluate((el) => {
          const rendered = (i) => i.getClientRects().length > 0 && getComputedStyle(i).visibility !== 'hidden';
          const src = (i) => i.currentSrc || i.src;
          const inside = (i) => i === el || el.contains(i);
          const broken = [...document.images].filter((i) => inside(i) && i.complete && i.naturalWidth === 0 && (i.getAttribute('src') || i.getAttribute('srcset')));
          const stalled = [...document.images].filter((i) => !i.complete && rendered(i));
          return {
            errors: [...stalled.filter(inside), ...broken].map(src),
            warnings: stalled.filter((i) => !inside(i)).map(src),
          };
        });
        imageErrors = [...new Set(imgs.errors)];
        pageImageWarnings = [...new Set(imgs.warnings)];
        // Fixed/sticky chrome (site header, cookie bar, sticky nav) would be painted over a tall element shot; hide all of
        // it except the target, its descendants and its ancestors. The context is closed afterwards, so no restore needed.
        await loc.evaluate((el) => {
          for (const n of document.querySelectorAll('body *')) {
            if (n === el || el.contains(n) || n.contains(el)) continue;
            const { position } = getComputedStyle(n);
            if (position === 'fixed' || position === 'sticky') n.style.setProperty('visibility', 'hidden', 'important');
          }
        });
        await page.waitForTimeout(150);
        await loc.screenshot({ path: out, animations: 'disabled' });
        box = await loc.boundingBox();
      } else {
        await page.screenshot({ path: out, fullPage });
      }
      return { out, url, selector: selector ?? null, width, scale, box, status, consoleErrors: errors.console, pageErrors: errors.page, imageErrors, pageImageWarnings };
    } catch (e) {
      throw withDiagnostics(e, errors, status);
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
