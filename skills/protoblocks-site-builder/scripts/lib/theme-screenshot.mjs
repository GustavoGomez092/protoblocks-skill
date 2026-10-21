#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadState, updateState, setPath } from './state.mjs';
import { assertFork } from './guards.mjs';
import { assertSlug } from './slugs.mjs';

// WordPress' recommended theme screenshot size (4:3).
export const SCREENSHOT_SIZE = Object.freeze({ width: 1200, height: 900 });
export const SCREENSHOT_FILE = 'screenshot.png';
const QA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'qa');
const err = (code, message) => Object.assign(new Error(message), { code });

/** The page's desktop frame (PNG or JPEG) from `pages[i].design.frames`, looked up by slug. */
export function screenshotFrame(state, page) {
  assertSlug(page, 'page slug');
  const p = state.pages.find((x) => x.slug === page);
  if (!p) throw err('ENOPAGE', `No page "${page}" in state; intake its desktop frame first (intake.mjs add-frame).`);
  const frame = (p.design?.frames ?? []).find((f) => f.breakpoint === 'desktop');
  if (!frame?.image) throw err('EINPUT', `Page "${page}" has no desktop frame; intake it first (intake.mjs add-frame "<themeDir>" ${page} desktop <image>).`);
  if (!/\.(png|jpe?g)$/i.test(frame.image)) throw err('EIMAGE', `The desktop frame of "${page}" is not a PNG or JPEG: ${frame.image}`);
  if (!fs.existsSync(frame.image)) throw err('EIMAGE', `The desktop frame of "${page}" is missing on disk: ${frame.image} (re-run intake.mjs add-frame).`);
  return frame;
}

// sharp lives with the QA dependencies; without them the import fails with the install command.
async function loadImageLib() {
  try {
    return await import('../qa/image.mjs');
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') throw err('EQADEPS', `The theme screenshot needs the QA dependencies (sharp). Install them once: cd "${QA_DIR}" && npm install && npx playwright install chromium`);
    throw e;
  }
}

/**
 * Writes <themeDir>/screenshot.png from the page's desktop frame: the top of the frame at its full width, 4:3,
 * resized to 1200x900. Records `site.theme.screenshot: {page, source: "frame", writtenAt}`.
 */
export async function themeScreenshot(themeDir, page, { cropTopToSize } = {}) {
  assertFork(themeDir);
  const frame = screenshotFrame(loadState(themeDir), page);
  const crop = cropTopToSize ?? (await loadImageLib()).cropTopToSize;
  const out = path.join(themeDir, SCREENSHOT_FILE);
  const r = await crop(frame.image, out, SCREENSHOT_SIZE);
  const writtenAt = new Date().toISOString();
  updateState(themeDir, (s) => { setPath(s, 'site.theme.screenshot', { page, source: 'frame', writtenAt }); });
  return { out, page, frame: frame.image, source: r.source, crop: r.crop, width: SCREENSHOT_SIZE.width, height: SCREENSHOT_SIZE.height, writtenAt };
}

const USAGE = 'Usage: node theme-screenshot.mjs <themeDir> <page>\n';

async function main(argv) {
  const [themeDir, page] = argv;
  if (argv.length !== 2 || !themeDir || !page || themeDir.startsWith('--') || page.startsWith('--')) { process.stderr.write(USAGE); process.exit(64); }
  process.stdout.write(`${JSON.stringify(await themeScreenshot(themeDir, page), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.code ? `[${e.code}] ` : ''}${e.message}\n`); process.exit(1); });
}
