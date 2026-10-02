import fs from 'node:fs';
import path from 'node:path';
import { forkMarker } from './theme-fork.mjs';
import { statePath } from './state.mjs';

/**
 * Writers (tokens apply, parts write, theme-assets install) may only modify a protoblocks fork:
 * a theme whose style.css carries the `Proto Fork:` marker or that holds .protoblocks/build.json.
 * Anything else (e.g. the developer's upstream proto-blocks-theme checkout) is refused with ENOTFORK.
 */
export function assertFork(themeDir) {
  const style = path.join(themeDir, 'style.css');
  if (fs.existsSync(style) && forkMarker(fs.readFileSync(style, 'utf8'))) return;
  if (fs.existsSync(statePath(themeDir))) return;
  const e = new Error(`${themeDir} is not a protoblocks theme fork (no "Proto Fork:" line in style.css and no .protoblocks/build.json); refusing to modify it. Run setup-site.mjs to create the fork and pass its folder.`);
  e.code = 'ENOTFORK';
  throw e;
}
