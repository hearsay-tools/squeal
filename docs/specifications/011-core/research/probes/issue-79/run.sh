#!/bin/sh
# Throwaway research probe (row 011-208). Run from the repository root:
#   sh docs/specifications/011-core/research/probes/issue-79/run.sh <out> [VAR=value ...]
# Waits while the one-minute load is above the CPU count, then runs gate.probe.ts once
# with the given GATE_* settings, writing <out>.jsonl and <out>-traces.jsonl here.
set -eu
dir=docs/specifications/011-core/research/probes/issue-79
out=$1; shift
while node -e 'const o=require("node:os"); process.exit(o.loadavg()[0] > o.cpus().length ? 0 : 1)'; do sleep 30; done
node -e 'const o=require("node:os"); console.log(JSON.stringify({at:new Date().toISOString(),load:o.loadavg(),cpus:o.cpus().length}))' >> "$dir/$out-load.jsonl"
env -u PLUGIN_ROOT -u PLUGIN_DATA GATE_OUT="$out" "$@" pnpm exec vitest run --config "$dir/vitest.config.ts" > "$dir/$out-output.txt" 2>&1
