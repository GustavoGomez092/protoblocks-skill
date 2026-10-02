#!/bin/sh
# Serialize Local-site tests across worktrees. Usage: pb-site-test.sh <worktree> [npm script]
# Exports PB_SITE_LOCK=1 (site tests skip without it). A watchdog stops the npm run after PB_SITE_TIMEOUT seconds
# (default 1800) with SIGTERM: the site tests then clean up from their run manifest (tests/.tmp/site-run-*.json).
# The lock is released only once every process of the run has exited, or PB_SITE_GRACE seconds (default 120) after
# the SIGTERM, when the rest is killed (a manifest left behind then makes the next run refuse to start until
# `pb-site-test.sh <worktree> test:recover` has restored the site).
# Keep /private/tmp/claude-501/pb-site-test.sh identical to this file (other worktrees run that copy).
WT="$1"; SCRIPT="${2:-test:integration}"; LIMIT="${PB_SITE_TIMEOUT:-1800}"; GRACE="${PB_SITE_GRACE:-120}"
LOCK="${PB_SITE_LOCK_DIR:-/private/tmp/claude-501/pb-site-lock}"
mkdir -p "$(dirname "$LOCK")" || exit 1
until mkdir "$LOCK" 2>/dev/null; do sleep 5; done
GROUP=""; DOG=""
# True while any process of the npm run's process group is alive.
alive() { [ -n "$GROUP" ] && kill -0 -- -"$GROUP" 2>/dev/null; }
# SIGTERM the run once (a second one would also kill the WP-CLI calls of its cleanup), give it GRACE seconds to clean
# up, then SIGKILL what is left.
stop_run() {
  alive || return 0
  kill -TERM -- -"$GROUP" 2>/dev/null
  n=0
  while alive && [ "$n" -lt "$GRACE" ]; do sleep 1; n=$((n + 1)); done
  if alive; then
    echo "pb-site-test: still running ${GRACE}s after SIGTERM; killing. Check tests/.tmp/site-run-*.json and run: $0 \"$WT\" test:recover" >&2
    kill -KILL -- -"$GROUP" 2>/dev/null
  fi
}
cleanup() {
  [ -n "$DOG" ] && kill -- -"$DOG" 2>/dev/null
  stop_run
  rmdir "$LOCK" 2>/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$WT" || exit 1
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
