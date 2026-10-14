#!/bin/sh
# Throwaway probe for 007-18, open question 5: full baselines of bench/ at batch sizes 1, 5, 10.
#   sh bench.sh <out dir> <size>...      (e.g. 1 5 10 10 5 1)
# Batch size is not a policy key in 0.1.174 (DEFAULT_BATCH_SIZE in run.ts, never wired from the
# policy), so each size other than 5 runs a copy of the pinned Claude Code plugin with that one
# constant changed: pin-b<N>/claude-code. Before each run: the bench daemon stopped and gone,
# bench's store removed, so every file runs; then the run starts only while the one-minute load
# is below 8 (the brief's gate), and the load is logged at start and end. Tier size 4 (policy
# default), backlog tier 200.
set -u
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/sq07-18
out=$1
shift
mkdir -p "$out"
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
e2e() { sudo -n -u squeal-e2e "$@"; }
load1() { cut -d' ' -f1 /proc/loadavg; }
pin() {
  [ "$1" = 5 ] && { echo "$R/pin/plugins/claude-code/dist/cli/squeal.mjs"; return; }
  dir=$R/pin-b$1/claude-code
  if ! e2e test -f "$dir/dist/cli/squeal.mjs"; then
    e2e mkdir -p "$R/pin-b$1"
    e2e cp -R "$R/pin/plugins/claude-code" "$dir"
    e2e sed -i "s/DEFAULT_BATCH_SIZE = 5;/DEFAULT_BATCH_SIZE = $1;/" "$dir/dist/cli/squeal.mjs"
  fi
  e2e grep -c "DEFAULT_BATCH_SIZE = $1;" "$dir/dist/cli/squeal.mjs" >&2
  echo "$dir/dist/cli/squeal.mjs"
}
n=0
for size in "$@"; do
  n=$((n + 1))
  cli=$(pin "$size")
  sq() { as bench node --disable-warning=ExperimentalWarning "$cli" "$@"; }
  sq stop "$R/bench" >/dev/null 2>&1
  i=0
  while sq status 2>&1 | grep -q '^Daemon: running' && [ $i -lt 120 ]; do sleep 1; i=$((i + 1)); done
  e2e rm -rf "$R/bench/.git/squeal"
  while [ "$(load1 | cut -d. -f1)" -ge 8 ]; do sleep 30; done
  f=$out/b$size-$n.txt
  {
    echo "== batch $size run $n start $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"
    t0=$(date +%s.%N)
    sq start
    sq run --all --wait | head -3
    t1=$(date +%s.%N)
    echo "== end $(date -u +%FT%TZ) wall $(echo "$t1 - $t0" | bc) s load $(cut -d' ' -f1-3 /proc/loadavg)"
    sq status | sed -n 1,4p
    node "$here/as-e2e.mjs" "$R" "$R" repo/.venv/bin/python -I - bench runs < "$here/store.py"
  } > "$f" 2>&1
  grep "^==" "$f"
  sq stop "$R/bench" >/dev/null 2>&1
done
