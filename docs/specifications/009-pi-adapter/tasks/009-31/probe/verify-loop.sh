#!/usr/bin/env bash
# Row 009-31: <rounds> runs of the repaired latency.test.ts in the worktree, each
# followed by one run of the copy's latency-lifted.test.ts (the same test with
# MAX_LOAD lifted, so its bound is asserted at any load), logged to $RESULTS.
# Usage: TREE=<worktree> COPY=<copy> RESULTS=<dir> verify-loop.sh <label> <rounds> [gap s]
set -u
label=$1 rounds=$2 gap=${3:-20}
for ((i = 1; i <= rounds; i++)); do
  for kind in real lifted; do
    if [[ $kind == real ]]; then dir=$TREE file=test/harness/pi/latency.test.ts
    else dir=$COPY file=test/harness/pi/latency-lifted.test.ts; fi
    echo "=== $(date -u +%H:%M:%S) $label $kind $i $(cut -d' ' -f1-3 /proc/loadavg)" >>"$RESULTS/$label.log"
    (cd "$dir" && npx vitest run "$file" --silent=false >>"$RESULTS/$label.log" 2>&1)
    echo "=== exit $? $(cut -d' ' -f1-3 /proc/loadavg)" >>"$RESULTS/$label.log"
  done
  sleep "$gap"
done
