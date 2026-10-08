#!/bin/sh
# Throwaway. Runs cursor S26-S28 of cezar's runner-shutdown-parity.test.ts N times.
# usage: run-cases.sh <cezar-clone> <label> <n>
# Prints, per run, the process ids that differ by launch mode, then pass/fail counts.
cd "$1" || exit 2
i=1
while [ "$i" -le "$3" ]; do
  ids=$(ps -o sid=,pgid=,tty= -p $$ | tr -s ' ')
  out=$(npx vitest run --project server packages/cezar/src/core/runner-shutdown-parity.test.ts -t 'cursor S2[678]' 2>&1)
  res=$(printf '%s\n' "$out" | grep -E '^ +Tests ' | tr -s ' ')
  enoent=$(printf '%s\n' "$out" | grep -c 'ENOENT')
  echo "$2 run=$i sid/pgid/tty=[$ids] tmpdir=${TMPDIR:-unset} $res enoent=$enoent"
  i=$((i+1))
done
