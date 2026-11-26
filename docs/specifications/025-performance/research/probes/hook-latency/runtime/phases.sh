#!/usr/bin/env bash
set -u
root=$(realpath "$1");old=$(realpath "$2");probe=$(cd "$(dirname "$0")" && pwd)
for version in 364 600 main; do
 tree=$old/$version;[ "$version" = main ] && tree=$root
 out=$root/runtime-results/$version/phase;mkdir -p "$out"
 PROBE_TRACE=1 PROBE_PHASE=1 node "$probe/prepare.mjs" "$tree" "$tree/runtime-phase"
 cd "$tree"
 PROBE_TRACE="$out" PROBE_PHASE=1 PROBE_INSTRUMENT="$probe/phase.mjs" timeout 600 "$root/node_modules/.bin/vitest" run --config runtime-phase/vitest.config.mjs runtime-phase/claude.test.ts > "$root/runtime-results/$version/phase.log" 2>&1
 echo "$version phase exit=$?" >> "$root/runtime-results/exits.txt"
done
node "$probe/startup.mjs" > "$root/runtime-results/startup-with-proxy.json"
