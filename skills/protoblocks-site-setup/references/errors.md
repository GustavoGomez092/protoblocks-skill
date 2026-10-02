# Site setup: rules and error codes

## Step 1 - Theme fork rules
- A folder whose `style.css` has the `Proto Fork:` marker is always reused, with or without `--force`, and nothing is downloaded (re-runs work offline).
- `--force` only applies to a foreign (non-fork) folder with the same slug.
- To replace an existing fork with a fresh copy of the theme, pass `--refork <slug>` repeating the slug exactly (`ERFORK` otherwise). Only with the developer's explicit OK: the new fork starts with fresh build state.
- A replaced folder (foreign under `--force`, fork under `--refork`) is moved, never deleted, to `wp-content/.protoblocks/backups/<slug>-<timestamp>/`; the result reports it as `theme.backup`. If the new fork cannot be set up, the folder is moved back.
- A symlinked theme folder is never replaced (`ESYMLINK`).
- The fork gets its own git repo, unless the themes folder is already inside a git work tree.

Plugins already installed are never replaced. When a newer Proto-Blocks release exists the result says `"updateAvailable": "<version>"` on the `proto-blocks` entry; tell the developer. Only with their explicit OK re-run with `--update-plugins`, which reinstalls Proto-Blocks from the release zip. It refuses with `EPLUGINDEV` when the plugin folder is a symlink or a git checkout (WordPress would delete the checkout, `.git` included); the developer updates that copy themselves (e.g. `git pull`).


## Step 1 errors

- `EPREFLIGHT` - lists the failing checks with fixes; relay them, change nothing.
- `EFORKEXISTS` - a folder with that slug exists and is not a protoblocks fork. Ask the developer; only on their explicit OK re-run with `--force` (the folder is moved to `wp-content/.protoblocks/backups/`), or pick another `--slug`.
- `ERFORK` - `--refork` did not repeat the theme slug exactly; nothing changed.
- `ESYMLINK` - the theme folder is a symlink (a development checkout); it is never replaced. Pick another `--slug`.
- `ESLUG` - bad or underivable slug; pick another with `--slug`.
- `ENOTHEME` - the downloaded zip had no theme.
- `ERELEASE` - a GitHub release lookup failed (offline, rate-limited, or no `vX.Y.Z` release with a zip): either Proto-Blocks is not installed yet, or the theme had to be downloaded (no existing fork to reuse). An installed Proto-Blocks and an existing fork need no network; retry when online.
- `EDOWNLOAD` - downloading the theme zip failed; retry when online.
- `EUNZIP` - the theme zip could not be extracted (corrupt download, or `unzip` missing); retry, or install `unzip`.
- `EPLUGINDEV` - `--update-plugins` refused because the plugin folder is a symlink or git checkout; the developer updates it themselves.
- `EWRONGSITE` - the fork's build state (`site.url`) belongs to another site than the one preflight resolved; nothing changed. Use the theme of this site, or, if the site was renamed, fix `site.url` with `state.mjs set` first (the message prints the command).
- `EWP` - a WP-CLI call failed; the message has its output.
- `EMANAGEDBLOCK` - the managed block in the theme's functions.php is broken; ask the developer to fix it by hand.
- `ENOFUNCTIONS` - the theme has no `functions.php`, so the managed assets cannot be wired; check the theme folder.


## Motion errors

- `EPROFILE` - unknown profile name or an invalid custom profile (duration 0-10, stagger 0-2, distance 0-400, ease 1-40 chars from `A-Za-z0-9.(), -`); nothing changed.
- `EMOTION` - `motion.mjs record` was given an unreadable check file, or a check that did not pass without `--accepted`. Fix the motion (see `protoblocks-motion`) or get the developer's acceptance.
- `ENOSECTION` - no section `<n>` on that page slug.

## Header/footer part errors

`ECONFIRM` (needs developer OK + id), `ESTALE` (the id changed; re-preview), `EAMBIGUOUS` (several copies; resolve in wp-admin), `ETHEMEMISMATCH` (the theme is not the active one, or the saved part does not resolve to this theme), `ESLUG`/`ETHEME` (invalid argument), `ENOTRASH` (Trash is disabled, so removal would delete permanently: tell the developer to use "Clear customizations" on the part in the Site Editor).

## Errors shared by every step

- `ENOTFORK` - the folder passed as `$THEME` is not a protoblocks fork (no `Proto Fork:` marker in `style.css`, no `.protoblocks/build.json`). `tokens apply`, `parts write` and the theme assets refuse it, so the developer's own `proto-blocks-theme` checkout is never rewritten. Pass `theme.themeDir` from setup.
- `EWRONGSITE` - see Step 1; tokens, navigation and parts check it too.
- `EARGV` - an internal WP-CLI `eval-file` argument started with `-` (WP-CLI would read it as a flag that runs PHP); report it as a bug, do not work around it.
- `ENAVKEY` - invalid menu key (start with a lowercase letter or digit; then lowercase letters, digits, `-`, `_`).
- `ENORUNTIME` - run preflight first.

