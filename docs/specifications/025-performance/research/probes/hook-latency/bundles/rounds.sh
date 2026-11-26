#!/bin/sh
# Throwaway probe (row 025-14): repeat rounds of the variant timings, run in a
# boat.dev sandbox by `boat.sh <out> rounds.sh` from the payload's root. A
# shared sandbox showed neighbour noise in single rounds (base `stop` p50 77
# to 116 ms between rounds), so each round interleaves the variants that
# matter and summarize-rounds.mjs pools them. Writes ./results/.
set -eu
P=docs/specifications/025-performance/research/probes/hook-latency/bundles
R=$PWD/results
S=$PWD/scratch
mkdir -p "$R" "$S"
export TMPDIR=$S
CASES='^(session-start|post-tool-batch|pre-tool-use|stop|stop-silent|user-prompt-submit|user-prompt-submit-silent)$'
VARIANTS="base minify builtins cut builtins+cut+minify"
probe() { timeout 1800 pnpm exec vitest run --config $P/vitest.probe.config.ts > "$R/$1.log" 2>&1; }
{
  node --version; nproc; grep -m1 'model name' /proc/cpuinfo; uptime
  for v in $VARIANTS; do pnpm exec tsx $P/build-variant.ts "$S/v/$v" "$v"; done
  D=$(for v in $VARIANTS; do printf "%s=%s," $v "$S/v/$v"; done | sed 's/,$//')
  for round in 1 2 3 4; do
    echo "round $round"; uptime
    PROBE_DISTS=$D PROBE_RUNS=20 PROBE_CASES=$CASES PROBE_OUT="$R/r$round-nocache.json" probe "r$round-nocache"
    PROBE_DISTS=$D PROBE_RUNS=20 PROBE_CASES=$CASES PROBE_ENV="{\"NODE_COMPILE_CACHE\":\"$S/cc/{dist}\"}" PROBE_OUT="$R/r$round-cache.json" probe "r$round-cache"
  done
  node $P/summarize-rounds.mjs "$R"/r*-nocache.json > "$R/rounds-nocache.txt"
  node $P/summarize-rounds.mjs "$R"/r*-cache.json > "$R/rounds-cache.txt"
  uptime
} > "$R/run.log" 2>&1
touch "$R/done"
