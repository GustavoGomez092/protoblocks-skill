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
export const SITE_URL = boot ? boot.check(['option', 'get', 'siteurl']).trim() : '';
export const ORIGINAL_THEME = boot ? boot.check(['option', 'get', 'stylesheet']).trim() : '';
export const runtime = { wp: WRAPPER, mode: 'local-wrapper', publicPath: PUBLIC, url: SITE_URL };
export const itest = (name, fn) => (haveSite ? test(name, fn) : test.skip(`${name} (start the Local site "${TEST_SITE}")`, fn));
export const testWp = () => createWp(runtime);

export async function useItestTheme(wp) {
  const themes = path.join(PUBLIC, 'wp-content', 'themes');
  const dir = path.join(themes, 'pb-itest');
  if (!fs.existsSync(path.join(dir, 'style.css'))) {
    let forked = false;
    try {
      const { fetchThemeZip, forkTheme } = await import('../../skills/protoblocks-site-builder/scripts/lib/theme-fork.mjs');
      const { zipFile, forkedFrom } = await fetchThemeZip();
      forkTheme({ wp, themesDir: themes, name: 'PB Itest', slug: 'pb-itest', zipFile, forkedFrom });
      forked = true;
    } catch { /* theme-fork.mjs not available yet (before Stage 2 Task 4) */ }
    if (!forked) {
      fs.cpSync(path.join(themes, ORIGINAL_THEME), dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('.git') });
    }
  }
  wp.check(['theme', 'activate', 'pb-itest']);
  return dir;
}

export const restoreTheme = (wp) => wp.check(['theme', 'activate', ORIGINAL_THEME]);
