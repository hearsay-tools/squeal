#!/usr/bin/env bash
# Throwaway. Run only in a boat.dev sandbox with an installed source checkout.
set -u
root=$(realpath "$1")
probe=$(cd "$(dirname "$0")" && pwd)
out=$root/runtime-results
mkdir -p "$out"
cd "$root"
{ node -v; uname -a; lscpu; cat /proc/loadavg; } > "$out/machine.txt"
# This task explicitly measures these tests. No validating Squeal daemon runs in this sandbox.
for harness in claude codex pi opencode antigravity; do
  node "$probe/prepare.mjs" "$root" "$root/runtime-probe"
  timeout 600 pnpm exec vitest run --config runtime-probe/vitest.config.mjs "runtime-probe/$harness.test.ts" > "$out/$harness.log" 2>&1
  echo "$harness exit=$?" >> "$out/exits.txt"
done
for round in 1 2 3; do
  for mode in direct cache launcher proxy; do
    PROBE_MODE=$mode PROBE_CACHE="$root/runtime-cache" PROBE_PLUGIN="$root/plugins/claude-code" timeout 600 pnpm exec vitest run --config runtime-probe/vitest.config.mjs runtime-probe/claude.test.ts > "$out/claude-$mode-$round.log" 2>&1
    echo "claude-$mode-$round exit=$?" >> "$out/exits.txt"
  done
done
mkdir -p "$out/trace"
PROBE_TRACE=1 node "$probe/prepare.mjs" "$root" "$root/runtime-trace"
PROBE_TRACE="$out/trace" PROBE_INSTRUMENT="$probe/instrument.mjs" timeout 600 pnpm exec vitest run --config runtime-trace/vitest.config.mjs runtime-trace/claude.test.ts > "$out/trace.log" 2>&1
echo "trace exit=$?" >> "$out/exits.txt"
cat /proc/loadavg >> "$out/machine.txt"
