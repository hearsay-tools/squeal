#!/usr/bin/env bash
# run.sh <outdir> <runs> <cases-regex> name=dir[,name=dir]
set -u
: "${S:?scratch dir}" "${W:?worktree}"
out=$1; mkdir -p "$out"; rm -f "$out"/after-*
cd ${W}
PROBE_ARM=${PROBE_ARM:-0} PROBE_DISTS=$4 PROBE_RUNS=$2 PROBE_CASES=$3 PROBE_OUT=$out/runs.json \
PROBE_NODE_ARGS="[\"--import\",\"$S/probe/after.mjs\"]" \
PROBE_ENV="{\"PROBE_AFTER\":\"$out/after-{case}@{dist}.txt\"${EXTRA_ENV:-}}" \
timeout 600 node_modules/.bin/vitest run --config ${S}/probe/vitest.config.ts 2>&1 | grep -v "^ *$" | tail -30
node $S/probe/summarize.mjs "$out"
