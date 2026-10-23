#!/bin/bash
# Task 011-122: busy-edit probe iterations in the instrumented copy.
# Usage: PROBE_ROOT=<copy> RESULTS=<dir> [SLOW=ms] [PROBE_TASKSET=cpus] probe-loop.sh <label> <repeat> [rounds]
P=${PROBE_ROOT:?the instrumented copy}
R=${RESULTS:?a results directory}/$1
mkdir -p "$R"
cd "$P" || exit 1
for round in $(seq 1 "${3:-1}"); do
  echo "$(date -u +%s) round $round start load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$R/loop.log"
  PROBE_OUT="$R" PROBE_RUN="r$round" PROBE_REPEAT="$2" PROBE_SLOW_MS="${SLOW:-0}" PROBE_TASKSET="${PROBE_TASKSET:-}" \
    timeout 1800 npx vitest run test/daemon/busy-edit.test.ts > "$R/vitest-r$round.out" 2>&1
  echo "$(date -u +%s) round $round exit $? load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$R/loop.log"
done
