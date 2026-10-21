#!/usr/bin/env bash
# Throwaway probe for research 013-05, question 1 on the fixture. Usage: run-fixture.sh <scratch> <n>
# Starts the research's own daemon with inside.mjs, then counts live Vitest instances
# (inside.mjs count-<label>) after: the baseline; <n> config edits (vitest.config.ts, a
# recreate trigger); <n> touches of a test file the instance read (mtime only, task 013-02),
# each carried by an edit of another test file; <n> edits of the slow-lane file, each a slow
# pass that creates the slow instance and closes it when the lane drains. Each step waits for
# the load to be below 24 first. Stops the daemon at the end.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/env.sh" "$1" fixture
N=$2
step() { sleep 3; ctl "count-$1"; }
wait_load; start_daemon; sleep 2
sq status --wait 300000 >"$S/log/status-baseline.txt" 2>&1
step baseline
for i in $(seq 1 "$N"); do
  wait_load; edit_and_wait vitest.config.ts "config-$i" test/m1.test.ts; step "config-$i"
done
for i in $(seq 1 "$N"); do
  wait_load; touch "$PROJ/test/m2.test.ts"; sleep 1
  edit_and_wait test/m3.test.ts "touch-$i" test/m3.test.ts; step "touch-$i"
done
for i in $(seq 1 "$N"); do
  wait_load; edit_and_wait test/slow.test.ts "slow-$i"; step "slow-$i"
done
sq status >"$S/log/status-end.txt" 2>&1
sq stop >"$S/log/stop.txt" 2>&1
