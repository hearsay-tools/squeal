#!/usr/bin/env bash
# trace.sh <outdir> <cases> name=dir : one instrumented run per case and a CPU profile run
set -u
: "${S:?scratch dir}" "${W:?worktree}"
out=$1; mkdir -p "$out"
cd ${W}
PROBE_ARM=${PROBE_ARM:-0} PROBE_DISTS=$3 PROBE_RUNS=3 PROBE_CASES=$2 PROBE_OUT=$out/runs.json \
PROBE_NODE_ARGS="[\"--import\",\"$S/probe/instrument.mjs\"]" \
PROBE_ENV="{\"PROBE_LOG\":\"$out/trace-{case}@{dist}-{run}.json\",\"PROBE_RAW\":\"${PROBE_RAW:-}\",\"PROBE_DEPTH\":\"${PROBE_DEPTH:-4}\"}" \
PROBE_RAW=${PROBE_RAW:-} PROBE_DEPTH=${PROBE_DEPTH:-4} timeout 600 node_modules/.bin/vitest run --config ${S}/probe/vitest.config.ts 2>&1 | grep -E "passed|failed|Error" | head
PROBE_ARM=${PROBE_ARM:-0} PROBE_DISTS=$3 PROBE_RUNS=3 PROBE_CASES=$2 PROBE_OUT=$out/runs2.json \
PROBE_NODE_ARGS="[\"--cpu-prof\",\"--cpu-prof-interval\",\"100\",\"--cpu-prof-dir\",\"$out/prof-{case}@{dist}\"]" \
PROBE_RAW=${PROBE_RAW:-} PROBE_DEPTH=${PROBE_DEPTH:-4} timeout 600 node_modules/.bin/vitest run --config ${S}/probe/vitest.config.ts 2>&1 | grep -E "passed|failed|Error" | head
