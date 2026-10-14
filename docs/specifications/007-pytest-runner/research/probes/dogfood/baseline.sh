#!/bin/sh
# Throwaway probe for 007-18: one full baseline, timed, as squeal-e2e.
#   sh baseline.sh <out file> <dir under the case root> [cli]
# `squeal run --all --wait` (or `node <cli> ...` for a patched pin copy) from a running daemon's
# start; the load is sampled every 10 s beside a status line. The wall time is the command's.
set -u
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/sq07-18
out=$1
dir=$2
cli=${3:-}
as() { node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
sq() { if [ -n "$cli" ]; then as node --disable-warning=ExperimentalWarning "$cli" "$@"; else as squeal "$@"; fi; }
{
  echo "== start $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg) dir $dir cli ${cli:-launcher}"
  t0=$(date +%s.%N)
  sq start
  ( while :; do sleep 10; printf '%s load %s | %s\n' "$(date -u +%T)" "$(cut -d' ' -f1 /proc/loadavg)" \
      "$(sq status 2>&1 | grep -m1 -E '^Revision|current' )"; done ) &
  poll=$!
  sq run --all --wait
  code=$?
  t1=$(date +%s.%N)
  kill "$poll" 2>/dev/null
  echo "== end $(date -u +%FT%TZ) exit $code wall $(echo "$t1 - $t0" | bc) s load $(cut -d' ' -f1-3 /proc/loadavg)"
  sq status
} > "$out" 2>&1
tail -3 "$out"
