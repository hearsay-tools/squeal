#!/usr/bin/env bash
# Throwaway probe for research 013-05. Question 2 and the reproductions: for each combination
# in /tmp/vcl-matrix (matrix-setup.sh), once the one-minute load is below 24: matrix-leak.mjs
# plain and with the break, vite-repro.mjs, and rolldown-repro.mjs with and without the cycle.
# Usage: run-matrix.sh <cycles> > logs/matrix.jsonl
HERE=$(cd "$(dirname "$0")" && pwd)
N=${1:-3}
wait_load() { while awk '{exit !($1 >= 24)}' /proc/loadavg; do sleep 20; done; }
for c in cezar squeal latest v4-latest vite7 vite7-v5; do
  R=/tmp/vcl-matrix/$c
  wait_load
  (cd "$R" && node --expose-gc "$HERE/matrix-leak.mjs" "$R" "$N")
  wait_load
  (cd "$R" && node --expose-gc "$HERE/matrix-leak.mjs" "$R" "$N" break)
  (cd "$R" && node --expose-gc "$HERE/vite-repro.mjs" "$R" "$N")
  if [ -d "$R/node_modules/rolldown" ]; then
    (cd "$R" && node --expose-gc "$HERE/rolldown-repro.mjs" "$R" cycle)
    (cd "$R" && node --expose-gc "$HERE/rolldown-repro.mjs" "$R" nocycle)
  fi
done
