#!/bin/sh
# Throwaway. Per-file durations of everything that is not the slow suite, in
# the copies, with at most 4 workers: this repository's Vitest suite minus
# test/e2e, and cezarion's test:unit (node:test). RUN names the output.
set -u
SCRATCH=${SCRATCH:?}; OUT=${OUT:-$SCRATCH/out}; RUN=${RUN:-1}
l0=$(cut -d' ' -f1 /proc/loadavg); t0=$(date +%s%N)
(cd "$SCRATCH/squeal" && npx vitest run --exclude 'test/e2e/**' --maxWorkers=4 --reporter=json --outputFile="$OUT/squeal-rest-$RUN.json" >"$OUT/squeal-rest-$RUN.log" 2>&1)
echo "squeal rest rc=$? ms=$(( ($(date +%s%N)-t0)/1000000 )) load0=$l0 load1=$(cut -d' ' -f1 /proc/loadavg)"
l0=$(cut -d' ' -f1 /proc/loadavg); t0=$(date +%s%N)
(cd "$SCRATCH/cezar/packages/cezar" && node --import ../../scripts/test-git-env.mjs --import tsx --test --test-concurrency=4 --test-reporter=junit --test-reporter-destination="$OUT/cezar-unit-$RUN.xml" test/unit/*.test.ts >/dev/null 2>&1)
echo "cezar unit rc=$? ms=$(( ($(date +%s%N)-t0)/1000000 )) load0=$l0 load1=$(cut -d' ' -f1 /proc/loadavg)"
