# Tests

| Script | What | Touches the Local site |
|---|---|---|
| `npm test` | `tests/unit`: pure unit tests | no |
| `npm run test:qa` | `tests/qa`: QA scripts against local fixture pages (needs `npm install` in `skills/protoblocks-site-builder/scripts/qa`) | no |
| `npm run test:integration` | `tests/integration`: WP-CLI, PHP writers, theme forks on the Local site "Proto Blocks" (`PB_TEST_SITE` overrides) | yes |
| `npm run test:e2e` | `tests/e2e`: the whole pipeline, design to a finished page, on the same site | yes |

## Site tests: only through the lock script

The integration and e2e tests run on the developer's real Local site. Run them only through the lock script
`tests/pb-site-test.sh`, one run at a time across all worktrees:

```bash
tests/pb-site-test.sh <worktree> test:integration
tests/pb-site-test.sh <worktree> test:e2e                     # two passes: WP global styles disabled, then on
PB_SITE_FILES="tests/integration/page.test.mjs tests/integration/yoast.test.mjs" \
  tests/pb-site-test.sh <worktree> test:site:files            # only some site-test files
tests/pb-site-test.sh <worktree> test:recover                 # after an interrupted run (below)
```

The script exports `PB_SITE_LOCK=1`. Without it, `itest` (`tests/integration/helpers.mjs`) and the e2e test skip with
"run via the site lock script", `testWp()` refuses (`ENOLOCK`) before any WP-CLI call, and `tests/recover.mjs` exits 2.
`npm test` has no site tests and needs no lock.

The lock is the directory `/private/tmp/claude-501/pb-site-lock` (`PB_SITE_LOCK_DIR` overrides). Other worktrees run
the shared copy `/private/tmp/claude-501/pb-site-test.sh`: keep it identical to `tests/pb-site-test.sh` (copy it after
every change; `tests/unit/site-run.test.mjs` checks). A watchdog stops a run after `PB_SITE_TIMEOUT` seconds (default
1800): it sends one SIGTERM to the run's process group, waits up to `PB_SITE_GRACE` seconds (default 120) for the tests
to clean up, then sends SIGKILL; the lock is released only after that. If the script itself was killed with `SIGKILL`
(its trap cannot run), check that no test is running, then remove the lock directory by hand.

## Run manifests and recovery

Every site test writes a run manifest, `tests/.tmp/site-run-<hex>.json` (`tests/site-run.mjs`), before its first change
and updates it after each one: the original theme, the option snapshots (theme mods, `sidebars_widgets`,
`theme_switched`, `current_theme`, the setup and plugin options, `proto_blocks_tailwind` with the global-styles
setting), the Proto-Blocks Tailwind cache (a byte copy in `tests/.tmp/site-run-<hex>-tailwind/`), the Yoast crash
snapshot, and every page, menu, attachment, template part, term and throwaway theme folder it creates (by id, or by
its unique name before the id exists). Cleanup removes entries as it goes; an empty manifest is deleted.

On SIGTERM or SIGINT (the watchdog, Ctrl-C) a test runs the same restore synchronously from its manifest and exits.
A manifest that is still there afterwards (SIGKILL, a cleanup that failed) makes every site test refuse to start, with
the recover command. `tests/pb-site-test.sh <worktree> test:recover` (`tests/recover.mjs`) restores exactly what each
manifest lists, with the same guards as the tests: it re-activates the original theme only away from a test theme,
deletes posts only when id, type and name match, deletes only throwaway theme folders (directly in the themes dir,
unique name, fork marker or build state, not active) and their `theme_mods_` rows, then puts the options, the Tailwind
cache and the Yoast options back. A manifest is deleted once all of it is restored; otherwise it is kept and the
problems are printed (exit 1): fix them by hand and run it again.

## Site-test safety rules

- Unique names per run (`pb-itest-*-<hex>`, `pb-e2e-<hex>`, `pb-nav-e2e-<hex>`); cleanup deletes by the exact id or
  name the run created, never by pattern.
- A test that switches themes records the original (in its run manifest, and `tests/.tmp/original-theme.txt`),
  re-activates it, restores the theme-switch options (`theme_mods_<original>`, `sidebars_widgets`, `theme_switched`,
  `current_theme`, plus `theme_mods_pb-itest` for the shared fixture; `takeThemeSnapshot` / `restoreTheme`) and
  deletes exactly the throwaway fork's `theme_mods_<slug>` row (`dropThemeMods`). The shared `pb-itest` fixture theme
  and its row stay.
- Gates and tokens recompile Proto-Blocks' site-wide Tailwind cache (`uploads/proto-blocks/tailwind/`, option
  `proto_blocks_tailwind`) for the active test theme; the same snapshot puts the files and option back byte for byte.
- `setupSite` / `ensurePlugins` run only when they would write nothing (`setupWriteReason`: plugins active, wizard
  flag set, Tailwind enabled with component style `tailwind`, non-plain permalinks); otherwise the test skips.
- Yoast options: `tests/integration/yoast-options.php` snapshot and exact restore; a leftover
  `tests/.tmp/yoast-options-snapshot.json` means a crashed run, and the tests refuse to start until it is restored.
- The e2e test changes Proto-Blocks' "Disable WP Global Styles" (`proto_blocks_tailwind.disable_global_styles`) only
  for its global-styles pass, and only when it differs; the whole option is restored and checked.
- The e2e reads the developer's template parts and menu (`PB_E2E_PARTS`, default `154,159`; `PB_E2E_MENU`, default
  `15`) only to check that they are unchanged.
- Never touch the developer's theme checkout, their template parts or menus, or plugins.
