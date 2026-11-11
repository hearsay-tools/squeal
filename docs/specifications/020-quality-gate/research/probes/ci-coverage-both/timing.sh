#!/bin/sh
# Throwaway. Usage: sh timing.sh <installed probe dir from run.sh> <squeal-worktree> <rounds>
# Alternates plain, tee and squeal runs; one line per run: mode, wall s, user s,
# sys s, the one-minute load before the run. Skips a round while the load is above 24.
set -eu
cd "$1"; TREE=$(cd "$2" && pwd); N=${3:-5}
export HOME=$(dirname "$1")/home TMPDIR=$(dirname "$1")/tmp
export SQUEAL_COVERAGE_CJS=$TREE/src/runners/vitest/ci-runtime/coverage.cjs
export SQUEAL_PROVIDER=$TREE/plugins/claude-code/dist/coverage/provider.mjs
export SQUEAL_MAPPER=$TREE/plugins/claude-code/dist/cli/coverage-map.mjs
export THRESHOLD=0
i=0
while [ $i -lt "$N" ]; do
  L=$(cut -d' ' -f1 /proc/loadavg)
  if [ "$(echo "$L > 24" | bc)" = 1 ]; then echo "round $i skipped: load $L"; sleep 30; continue; fi
  for m in plain tee squeal; do
    L=$(cut -d' ' -f1 /proc/loadavg)
    /usr/bin/time -f "$m %e %U %S load=$L" node probe.mjs "$m" "$TMPDIR/t" > /dev/null 2> "$TMPDIR/time.txt" || true
    tail -1 "$TMPDIR/time.txt"
  done
  i=$((i + 1))
done
