#!/bin/sh
# Throwaway. Times cezarion's test:package per file (one file at a time) and
# whole (the script as written), with the 1-minute load before and after each.
set -u
SCRATCH=${SCRATCH:?}
OUT=${OUT:-$SCRATCH/out}; mkdir -p "$OUT"
cd "$SCRATCH/cezar/packages/cezar"
load() { cut -d' ' -f1 /proc/loadavg; }
if [ "${MODE:-files}" = files ]; then
  for f in test/e2e/*.test.ts; do
    l0=$(load); t0=$(date +%s%N)
    node --import ../../scripts/test-git-env.mjs --import tsx --test --test-reporter=tap "$f" >"$OUT/cezar-$(basename "$f").tap" 2>&1
    rc=$?; t1=$(date +%s%N)
    echo "$(basename "$f") rc=$rc ms=$(( (t1-t0)/1000000 )) load0=$l0 load1=$(load)"
  done
else
  l0=$(load); t0=$(date +%s%N)
  node --import ../../scripts/test-git-env.mjs --import tsx --test --test-reporter=tap test/e2e/*.test.ts >"$OUT/cezar-all.tap" 2>&1
  rc=$?; t1=$(date +%s%N)
  echo "all rc=$rc ms=$(( (t1-t0)/1000000 )) load0=$l0 load1=$(load)"
fi
