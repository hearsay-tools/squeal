#!/bin/sh
# Throwaway. Runs each cezarion test:package file once with Squeal's recorder
# (src/runners/node-test/runtime/recorder.cjs) in NODE_OPTIONS, so every Node
# process the test spawns (the CLI, npm, helpers) records what it loaded too.
# One graph directory per test file; observed.mjs summarises.
set -u
SCRATCH=${SCRATCH:?}
REC="$SCRATCH/squeal/src/runners/node-test/runtime/recorder.cjs"
OUT=${OUT:-$SCRATCH/out}/observed; mkdir -p "$OUT"
cd "$SCRATCH/cezar/packages/cezar"
for f in test/e2e/*.test.ts; do
  b=$(basename "$f" .test.ts); mkdir -p "$OUT/$b"
  SQUEAL_NODE_TEST_GRAPH="$OUT/$b/graph" NODE_OPTIONS="--require $REC" \
    node --import ../../scripts/test-git-env.mjs --import tsx --test --test-reporter=dot "$f" >"$OUT/$b.log" 2>&1
  echo "$b rc=$? pids=$(ls "$OUT/$b" | wc -l)"
done
