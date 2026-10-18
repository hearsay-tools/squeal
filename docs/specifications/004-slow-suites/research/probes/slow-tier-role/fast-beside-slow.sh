#!/bin/sh
# Throwaway. Fast-lane latency with and without a slow lane beside it, in a scratch Squeal
# clone (cwd, scratch HOME/XDG exported). The fast run is one edit-sized tier (4 files,
# nice 10 as 001 D11 runs every test process); the slow lane is two e2e files at nice 10,
# ionice idle, two workers (slow.maxWorkers), restarted until the fast runs end.
# Prints one line per fast run: mode, wall ms, Vitest's own duration, 1-min load.
# Usage: fast-beside-slow.sh <reps> <label>
reps=$1 label=$2
FAST=${FAST:-"test/state/sink.test.ts test/state/transitions.test.ts test/state/flaky.test.ts test/state/fingerprint.test.ts"}
SLOW="test/e2e/policy.test.ts test/e2e/lifecycle.test.ts"
fast() {
  t0=$(date +%s%N)
  d=$(nice -n 10 npx vitest run $FAST 2>&1 | sed -n 's/.*Duration *\([0-9.]*m*s\).*/\1/p')
  t1=$(date +%s%N)
  echo "$label $1 wall_ms=$(( (t1 - t0) / 1000000 )) vitest=$d load=$(cut -d' ' -f1 /proc/loadavg)"
}
i=0; while [ $i -lt "$reps" ]; do fast alone; i=$((i + 1)); done
setsid sh -c "while :; do nice -n 10 ionice -c 3 npx vitest run $SLOW --maxWorkers=2 >/dev/null 2>&1; done" &
loop=$!  # setsid makes it a group leader: its pid is the group id
sleep 20
i=0; while [ $i -lt "$reps" ]; do fast beside-slow; i=$((i + 1)); done
kill -- -$loop 2>/dev/null
wait 2>/dev/null
