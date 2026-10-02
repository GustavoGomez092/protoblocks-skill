#!/bin/sh
# Serialize Local-site tests across worktrees. Usage: pb-site-test.sh <worktree> [npm script]
# Exports PB_SITE_LOCK=1 (site tests skip without it). A watchdog stops the npm run after PB_SITE_TIMEOUT seconds
# (default 1800) with one SIGTERM (Ctrl-C on this script does the same). The script waits until every process of the
# run has exited (SIGKILL after PB_SITE_GRACE seconds, default 120), then, still holding the lock, restores the site
# from the run manifests the tests left (tests/.tmp/site-run-*.json, via tests/recover.mjs): the node test runner
# takes its test-file processes down with it, so their own signal handlers cannot be relied on. If that recovery is
# incomplete, the next run refuses to start until `pb-site-test.sh <worktree> test:recover` has restored the site.
# Keep /private/tmp/claude-501/pb-site-test.sh identical to this file (other worktrees run that copy).
WT="$1"; SCRIPT="${2:-test:integration}"; LIMIT="${PB_SITE_TIMEOUT:-1800}"; GRACE="${PB_SITE_GRACE:-120}"
LOCK="${PB_SITE_LOCK_DIR:-/private/tmp/claude-501/pb-site-lock}"
WT_ABS=$(cd "$WT" 2>/dev/null && pwd) || { echo "pb-site-test: no such worktree: $WT" >&2; exit 1; }
mkdir -p "$(dirname "$LOCK")" || exit 1
until mkdir "$LOCK" 2>/dev/null; do sleep 5; done
GROUP=""; DOG=""; STOPPED=""
# True while any process of the npm run's process group is alive.
alive() { [ -n "$GROUP" ] && kill -0 -- -"$GROUP" 2>/dev/null; }
# SIGTERM the run once (a second one would also kill the WP-CLI calls of its cleanup), give it GRACE seconds to clean
# up, then SIGKILL what is left.
stop_run() {
  alive || return 0
  STOPPED=1
  kill -TERM -- -"$GROUP" 2>/dev/null
  n=0
  while alive && [ "$n" -lt "$GRACE" ]; do sleep 1; n=$((n + 1)); done
  if alive; then
    echo "pb-site-test: still running ${GRACE}s after SIGTERM; killing it" >&2
    kill -KILL -- -"$GROUP" 2>/dev/null
  fi
}
# After a stopped run: restore the site from the manifests it left (exactly what they list; tests/recover.mjs).
recover_run() {
  [ -n "$STOPPED" ] && [ -f "$WT_ABS/tests/recover.mjs" ] || return 0
  ls "$WT_ABS"/tests/.tmp/site-run-*.json >/dev/null 2>&1 || return 0
  echo "pb-site-test: restoring the site from the run manifest(s) in $WT_ABS/tests/.tmp" >&2
  ( cd "$WT_ABS" && PB_SITE_LOCK=1 node tests/recover.mjs >&2 ) \
    || echo "pb-site-test: recovery incomplete (see above); fix it, then run: $0 \"$WT_ABS\" test:recover" >&2
}
cleanup() {
  [ -n "$DOG" ] && kill -- -"$DOG" 2>/dev/null
  stop_run
  recover_run
  rmdir "$LOCK" 2>/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$WT_ABS" || exit 1
export PB_SITE_LOCK=1
set -m # background jobs get their own process group, so the watchdog can stop npm and every node child
npm run "$SCRIPT" &
GROUP=$!
# The watchdog signals this script, whose exit (cleanup -> stop_run) stops the run.
( sleep "$LIMIT"; echo "pb-site-test: timed out after ${LIMIT}s; stopping npm run $SCRIPT (SIGTERM, ${GRACE}s grace)" >&2
  kill -TERM $$ ) &
DOG=$!
set +m # groups stay; no job-status chatter
wait "$GROUP"; STATUS=$?
# npm has exited; anything of its group still running gets the same SIGTERM and grace (cleanup: stop_run).
exit "$STATUS"
