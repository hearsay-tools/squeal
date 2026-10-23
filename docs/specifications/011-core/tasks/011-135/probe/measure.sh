#!/bin/sh
# Row 011-135 probe, step 2: each parity file of cezarion#1269 run whole against `vitest -t` on
# the two checks whose assertions PR 1384 changed (U2 and U3 of `waits-parity-cells.testkit.ts`).
# Usage: S=/tmp/d1-135-XXXX sh measure.sh <red|green> <whole reps> <focused reps> <runner>...
#   red:   run.ts at 6a4db210^ (the footer still joined), so the two new assertions fail;
#   green: run.ts at 6a4db210, so they pass.
#   runner: claude, codex, cursor, omp, opencode, pi, or once (waits-parity.test.ts).
# Before each run it waits until the one-minute load is below LOAD_MAX (16) and prints it.
# No Squeal, no daemon: the clone's own Vitest CLI only.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
phase=$1 whole=$2 focused=$3
shift 3
LOAD_MAX=${LOAD_MAX:-16}
PATTERN='U2 ci and timer open|U3 a human message during a ci wait'
cd "$REPO"
case "$phase" in
  red) git checkout -q 6a4db210^ -- packages/cezar/src/workflows/run.ts ;;
  green) git checkout -q 6a4db210 -- packages/cezar/src/workflows/run.ts ;;
  *) echo "phase must be red or green"; exit 2 ;;
esac
export NO_COLOR=1 FORCE_COLOR=0
wait_load() {
  while :; do
    read -r load _ </proc/loadavg
    [ "$(echo "$load < $LOAD_MAX" | bc)" = 1 ] && return 0
    sleep 20
  done
}
one() { # <label> <file> [vitest args...]
  label=$1 file=$2
  shift 2
  wait_load
  read -r load _ </proc/loadavg
  t0=$(date +%s.%N)
  out=$(./node_modules/.bin/vitest run "$file" "$@" 2>&1)
  t1=$(date +%s.%N)
  tests=$(printf '%s\n' "$out" | grep -E '^ +Tests ' | sed 's/^ *//')
  dur=$(printf '%s\n' "$out" | grep -E '^ +Duration ' | sed 's/^ *Duration *//')
  printf '%s\t%s\t%s\tload %s\twall %.1f s\t%s\t%s\n' "$(date -u +%TZ)" "$phase" "$label" \
    "$load" "$(echo "$t1 - $t0" | bc)" "$tests" "$dur"
}
echo "# $(git log --oneline -1); run.ts at $phase; $(nproc) CPUs; $(date -u +%FT%TZ)"
for runner in "$@"; do
  case "$runner" in
    once) file=packages/cezar/src/workflows/waits-parity.test.ts ;;
    *) file=packages/cezar/src/workflows/waits-$runner-parity.test.ts ;;
  esac
  i=0
  while [ "$i" -lt "$whole" ]; do one "$runner whole" "$file"; i=$((i + 1)); done
  i=0
  while [ "$i" -lt "$focused" ]; do one "$runner -t" "$file" -t "$PATTERN"; i=$((i + 1)); done
done
git checkout -q 6a4db210 -- packages/cezar/src/workflows/run.ts
