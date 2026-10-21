#!/usr/bin/env bash
# Throwaway probe for research 013-05, question 1 on the cezar clone (cezar-setup.sh).
# Usage: run-cezar.sh <scratch> <n>
# Starts the research's own daemon with inside.mjs under cezar's own lookup-only baseline, then
# counts live Vitest instances (inside.mjs count-<label>) after: the baseline (listed and
# keyed, nothing run); one warm edit; <n> touches of a test file the instance read (mtime
# only, task 013-02: the instance is replaced at the next call), each carried by an edit of
# another test file; <n> edits of the slow-lane file (a slow pass makes the slow instance and
# closes it when the lane drains). Each step waits for the load to be below 24 first.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/env.sh" "$1" cezar
N=$2
CARRIER=packages/cezar/src/core/cursor-cli-flags.test.ts
TOUCHED=packages/cezar/src/core/effort.test.ts
SLOW=packages/cezar/src/agent-config/model-settings/shared.test.ts
step() { sleep 5; ctl "count-$1"; }
wait_load; start_daemon; sleep 5
sq status --wait 600000 >"$S/log/status-baseline.txt" 2>&1
step baseline
wait_load; edit_and_wait "$CARRIER" warm-1; step warm-1
for i in $(seq 1 "$N"); do
  wait_load; touch "$PROJ/$TOUCHED"; sleep 1
  edit_and_wait "$CARRIER" "touch-$i"; step "touch-$i"
done
for i in $(seq 1 "$N"); do
  wait_load; edit_and_wait "$SLOW" "slow-$i"; step "slow-$i"
done
sq status >"$S/log/status-end.txt" 2>&1
sq stop >"$S/log/stop.txt" 2>&1
