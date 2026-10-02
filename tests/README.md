# Tests

| Script | What | Touches the Local site |
|---|---|---|
| `npm test` | `tests/unit`: pure unit tests | no |
| `npm run test:qa` | `tests/qa`: QA scripts against local fixture pages (needs `npm install` in `skills/protoblocks-site-builder/scripts/qa`) | no |
| `npm run test:integration` | `tests/integration`: WP-CLI, PHP writers, theme forks on the Local site "Proto Blocks" (`PB_TEST_SITE` overrides) | yes |
| `npm run test:e2e` | `tests/e2e`: the whole pipeline, design to a finished page, on the same site | yes |

## Site tests: only through the lock script

The integration and e2e tests run on the developer's real Local site. Run them only through the lock script, one run at
a time across all worktrees:

```bash
/private/tmp/claude-501/pb-site-test.sh <worktree> test:integration
/private/tmp/claude-501/pb-site-test.sh <worktree> test:e2e
```

The script exports `PB_SITE_LOCK=1`. Without it, `itest` (`tests/integration/helpers.mjs`) and the e2e test skip with
"run via the site lock script", and `testWp()` refuses (`ENOLOCK`) before any WP-CLI call. `npm test` has no site
tests and needs no lock.

The script lives outside the repo; its content:

```sh
#!/bin/sh
# Serialize Local-site integration tests across worktrees. Usage: pb-site-test.sh <worktree> [npm script]
# Exports PB_SITE_LOCK=1 (site tests skip without it). A watchdog stops the npm run after PB_SITE_TIMEOUT seconds
# (default 1800); the lock is always released on exit.
WT="$1"; SCRIPT="${2:-test:integration}"; LIMIT="${PB_SITE_TIMEOUT:-1800}"
LOCK="/private/tmp/claude-501/pb-site-lock"
until mkdir "$LOCK" 2>/dev/null; do sleep 5; done
CHILD=""; DOG=""
cleanup() {
  [ -n "$DOG" ] && kill -- -"$DOG" 2>/dev/null
  [ -n "$CHILD" ] && kill -- -"$CHILD" 2>/dev/null
  rmdir "$LOCK" 2>/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT TERM
cd "$WT" || exit 1
export PB_SITE_LOCK=1
set -m # background jobs get their own process group, so the watchdog can stop npm and every node child
npm run "$SCRIPT" &
CHILD=$!
( sleep "$LIMIT"; echo "pb-site-test: timed out after ${LIMIT}s; stopping npm run $SCRIPT" >&2
  kill -TERM -- -"$CHILD" 2>/dev/null; sleep 10; kill -KILL -- -"$CHILD" 2>/dev/null ) &
DOG=$!
set +m # groups stay; no job-status chatter
wait "$CHILD"; STATUS=$?
CHILD=""
exit "$STATUS"
```

The lock is the directory `/private/tmp/claude-501/pb-site-lock`. If a run was killed with `SIGKILL` (the trap cannot
run), check that no test is running, then remove the directory by hand.

## Site-test safety rules

- Unique names per run (`pb-itest-*-<hex>`, `pb-e2e-<hex>`, `pb-nav-e2e-<hex>`); cleanup deletes by the exact id or
  name the run created, never by pattern.
- A test that switches themes records the original (`tests/.tmp/original-theme.txt` for crash recovery), re-activates
  it, restores the theme-switch options (`theme_mods_<original>`, `sidebars_widgets`, `theme_switched`,
  `current_theme`, plus `theme_mods_pb-itest` for the shared fixture; `takeThemeSnapshot` / `restoreTheme`) and
  deletes exactly the throwaway fork's `theme_mods_<slug>` row (`dropThemeMods`). The shared `pb-itest` fixture theme
  and its row stay.
- Gates and tokens recompile Proto-Blocks' site-wide Tailwind cache (`uploads/proto-blocks/tailwind/`, option
  `proto_blocks_tailwind`) for the active test theme; the same snapshot puts the files and option back byte for byte.
- `setupSite` / `ensurePlugins` run only when they would write nothing (`setupWriteReason`: plugins active, wizard
  flag set, Tailwind enabled with component style `tailwind`, non-plain permalinks); otherwise the test skips.
- Yoast options: `tests/integration/yoast-options.php` snapshot and exact restore; a leftover
  `tests/.tmp/yoast-options-snapshot.json` means a crashed run, and the tests refuse to start until it is restored.
- Never touch the developer's theme checkout, their template parts or menus, or plugins.
