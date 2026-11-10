#!/usr/bin/env bash
# Throwaway probe for research/child-coverage.md. Not product code.
# Usage: run.sh <squeal worktree> <scratch>
# Builds the fixture, runs it under the two prototype seams (Vitest forks,
# Vitest threads, node:test), and leaves the raw files in <scratch>/out-*.
set -euo pipefail
SQ=$1
S=$2
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$S"
FX=$(node "$HERE/fixture.mjs" "$SQ" "$S" "$SQ/node_modules" | tail -1)
cd "$FX"
echo "load before: $(cut -d' ' -f1-3 /proc/loadavg)"
for pool in forks threads; do
  OUT="$S/out-$pool"
  rm -rf "$OUT" .probe/seen.ndjson
  mkdir -p "$OUT"
  PROBE_OUT="$OUT" CI=1 HOME="$S/home" node_modules/.bin/vitest run --pool=$pool \
    --coverage.enabled --coverage.provider=custom \
    --coverage.customProviderModule="$FX/provider-children.mjs" \
    --coverage.reportsDirectory="$OUT/reports" >"$OUT/vitest.txt" 2>&1 || echo "vitest $pool exit $?"
  cp .probe/seen.ndjson "$OUT/seen.ndjson"
  # the detached child exits 1.5 s after it started; look again after it
  ls -R "$OUT/children" >"$OUT/children-at-end.txt"
  sleep 2
  ls -R "$OUT/children" >"$OUT/children-later.txt"
done
OUT="$S/out-node"
rm -rf "$OUT"
mkdir -p "$OUT/cov" "$OUT/graph"
NODE_V8_COVERAGE="$OUT/cov" SQUEAL_NODE_TEST_COVERAGE="$OUT/cov" SQUEAL_NODE_TEST_GRAPH="$OUT/graph/g" \
  HOME="$S/home" node --require "$FX/children.cjs" --require "$SQ/src/runners/node-test/runtime/recorder.cjs" \
  --test test/n.test.mjs >"$OUT/node.txt" 2>&1 || echo "node --test exit $?"
ls -R "$OUT/cov" >"$OUT/cov.txt"
echo "load after: $(cut -d' ' -f1-3 /proc/loadavg)"
