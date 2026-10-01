import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWp } from '../../skills/protoblocks-site-builder/scripts/lib/wp.mjs';
import { resolveLocalSite, writeWrapper } from '../../skills/protoblocks-site-builder/scripts/lib/local-site.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEST_SITE = process.env.PB_TEST_SITE ?? 'Proto Blocks';
const resolved = resolveLocalSite({ query: TEST_SITE });
const WRAPPER = path.join(REPO, 'tests', '.tmp', 'wp-test-site');
if (resolved.ok) writeWrapper(WRAPPER, resolved.site);

export const haveSite = resolved.ok;
export const PUBLIC = resolved.ok ? resolved.site.publicPath : '';
const boot = resolved.ok ? createWp({ wp: WRAPPER, mode: 'local-wrapper', publicPath: PUBLIC }) : null;

let siteUrl = '';
let originalTheme = '';
let skipReason = '';

if (boot) {
  try {
    siteUrl = boot.check(['option', 'get', 'siteurl']).trim();
  } catch (err) {
    skipReason = `WP-CLI failed to get siteurl: ${err.message}`;
  }
  try {
    const active = boot.check(['option', 'get', 'stylesheet']).trim();
    if (active.startsWith('pb-')) {
      // Crashed run left site on pb-itest or pb-* theme. Recover the original.
      originalTheme = process.env.PB_TEST_THEME ||
        (fs.existsSync(path.join(REPO, 'tests', '.tmp', 'original-theme.txt'))
          ? fs.readFileSync(path.join(REPO, 'tests', '.tmp', 'original-theme.txt'), 'utf8').trim()
          : '');
      if (!originalTheme) {
        skipReason = `test site left on ${active}; set PB_TEST_THEME`;
      }
    } else {
      originalTheme = active;
    }
  } catch (err) {
    skipReason = `WP-CLI failed to get stylesheet: ${err.message}`;
  }
}

export const SITE_URL = siteUrl;
export const ORIGINAL_THEME = originalTheme;
export const runtime = { wp: WRAPPER, mode: 'local-wrapper', publicPath: PUBLIC, url: SITE_URL };
export const itest = (name, fn) => {
  if (!haveSite) return test.skip(`${name} (start the Local site "${TEST_SITE}")`, fn);
  if (skipReason) return test.skip(`${name} (${skipReason})`, fn);
  return test(name, fn);
};
export const testWp = () => createWp(runtime);

export async function useItestTheme(wp) {
  const themes = path.join(PUBLIC, 'wp-content', 'themes');
  const dir = path.join(themes, 'pb-itest');
  const tmpDir = path.join(REPO, 'tests', '.tmp');
  const originalThemeFile = path.join(tmpDir, 'original-theme.txt');

  if (!fs.existsSync(path.join(dir, 'style.css'))) {
    let forked = false;
    try {
      const { fetchThemeZip, forkTheme } = await import('../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs');
      const { zipFile, forkedFrom } = await fetchThemeZip();
      forkTheme({ wp, themesDir: themes, name: 'PB Itest', slug: 'pb-itest', zipFile, forkedFrom });
      forked = true;
    } catch (err) {
      if (err.code !== 'ERR_MODULE_NOT_FOUND') {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
        throw err;
      }
      /* theme-fork.mjs not available yet (before Stage 2 Task 4) */
    }
    if (!forked) {
      const src = path.join(themes, ORIGINAL_THEME);
      fs.cpSync(src, dir, {
        recursive: true,
        filter: (fullSrc) => {
          const rel = path.relative(src, fullSrc);
          return !rel.split(path.sep).some(part => part === '.git' || part === 'node_modules');
        }
      });
    }
  }

  // Record original theme before switching
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(originalThemeFile, ORIGINAL_THEME);

  wp.check(['theme', 'activate', 'pb-itest']);
  return dir;
}

export const restoreTheme = (wp) => {
  const tmpDir = path.join(REPO, 'tests', '.tmp');
  const originalThemeFile = path.join(tmpDir, 'original-theme.txt');
  wp.check(['theme', 'activate', ORIGINAL_THEME]);
  if (fs.existsSync(originalThemeFile)) {
    fs.unlinkSync(originalThemeFile);
  }
};
