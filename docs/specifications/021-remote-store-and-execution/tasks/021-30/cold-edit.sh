#!/usr/bin/env bash
# Throwaway probe for row 021-30: edit-to-verdict after D20's idle close, before and after.
#   cold-edit.sh <scratch> <plugin copy> <label> [cycles]
# Runs only in the scratch setup.sh makes, with its HOME, XDG_* and TMPDIR. Starts a daemon of
# the plugin copy's bundle on <scratch>/squeal with a fresh store and runner.hostIdleMinutes 1,
# waits until it settles and its Vitest host has closed, then per cycle: edits a test file
# (cold, then again at once: warm), waits for the host to close, edits a source with one
# importing test file (cold). Each edit waits for its verdict through the scratch's socket.
# Appends `utc label kind path ms load` lines to <scratch>/log/cold-edit.tsv. Edits wait while
# the one-minute load is 24 or more. Restores the edited files and stops the daemon at the end.
set -euo pipefail
S=$1 B=$2 L=$3 N=${4:-3}
R=$S/squeal
export HOME=$S/home XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
CLI=$B/dist/cli/squeal.mjs
TEST=test/runners/pytest/graph/import-context.test.ts
SOURCE=src/harness/opencode/protocol.ts
OUT=$S/log/cold-edit.tsv
sq() { (cd "$R" && node "$CLI" "$@"); }
load1() { cut -d' ' -f1 /proc/loadavg; }
host_up() { pgrep -f "runner-host $R --runner vitest" >/dev/null; }
below_24() { while awk -v l="$(load1)" 'BEGIN { exit !(l >= 24) }'; do sleep 15; done; }
host_closed() {
  local waited=0
  while host_up; do
    sleep 5
    waited=$((waited + 5))
    if [ "$waited" -ge 900 ]; then echo "host still up after 900 s" >&2; return 1; fi
  done
}
edit() {
  local kind=$1 path=$2 t0 t1
  below_24
  t0=$(date +%s%3N)
  printf '\n// probe 021-30 %s %s\n' "$L" "$kind" >>"$R/$path"
  sq status --wait 600000 "$path" >"$S/log/status-$L-$kind-$t0.txt" 2>&1 || true
  t1=$(date +%s%3N)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%H:%M:%SZ)" "$L" "$kind" "$path" "$((t1 - t0))" "$(load1)" | tee -a "$OUT"
}
cleanup() {
  sq stop >/dev/null 2>&1 || true
  git -C "$R" checkout -- "$TEST" "$SOURCE"
}
trap cleanup EXIT

mkdir -p "$S/config/squeal"
echo '{ "capacity": { "hostSlots": 4 }, "runner": { "hostIdleMinutes": 1 } }' >"$S/config/squeal/config.json"
rm -rf "$R/.git/squeal"
(cd "$R" && exec setsid node "$CLI" daemon "$R" </dev/null >"$S/log/daemon-$L.out" 2>&1) &
sleep 5
t0=$(date +%s%3N)
sq status --wait 900000 >"$S/log/status-$L-settle.txt" 2>&1 || true
printf '%s\t%s\tsettle\t-\t%s\t%s\n' "$(date -u +%H:%M:%SZ)" "$L" "$(($(date +%s%3N) - t0))" "$(load1)" | tee -a "$OUT"
# The start's closures keep the host up; wait until it is up, then each cycle waits for it to close.
for _ in $(seq 1 24); do host_up && break; sleep 5; done
for c in $(seq 1 "$N"); do
  host_closed
  edit "cold-test" "$TEST"
  edit "warm-test" "$TEST"
  host_closed
  edit "cold-source" "$SOURCE"
done
