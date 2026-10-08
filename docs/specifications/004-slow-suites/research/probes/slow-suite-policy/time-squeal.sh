#!/bin/sh
# Throwaway. Times this repository's test/e2e in the copy: MODE=all is
# `vitest run test/e2e` as CI runs it; MODE=serial adds --no-file-parallelism.
# Per-file durations come from the JSON reporter (summarise.mjs).
set -u
SCRATCH=${SCRATCH:?}
OUT=${OUT:-$SCRATCH/out}; mkdir -p "$OUT"
cd "$SCRATCH/squeal"
MODE=${MODE:-all}
extra=""; [ "$MODE" = serial ] && extra="--no-file-parallelism"
l0=$(cut -d' ' -f1 /proc/loadavg); t0=$(date +%s%N)
npx vitest run test/e2e $extra --reporter=json --outputFile="$OUT/squeal-$MODE-${RUN:-1}.json" >"$OUT/squeal-$MODE-${RUN:-1}.log" 2>&1
rc=$?; t1=$(date +%s%N)
echo "squeal e2e $MODE rc=$rc ms=$(( (t1-t0)/1000000 )) load0=$l0 load1=$(cut -d' ' -f1 /proc/loadavg)"
