#!/usr/bin/env bash
# Run after run.sh, on the same quiet boat.dev sandbox. Each old tree uses its own fixtures.
set -u
root=$(realpath "$1")
old=$(realpath "$2")
probe=$(cd "$(dirname "$0")" && pwd)
for version in 364 600 main; do
  tree=$old/$version
  [ "$version" = main ] && tree=$root
  [ -e "$tree/node_modules" ] || ln -s "$root/node_modules" "$tree/node_modules"
  out=$root/runtime-results/$version
  mkdir -p "$out/trace" "$out/summary"
  node "$probe/prepare.mjs" "$tree" "$tree/runtime-probe"
  cd "$tree"
  for round in 1 2 3; do
    timeout 600 "$root/node_modules/.bin/vitest" run --config runtime-probe/vitest.config.mjs runtime-probe/claude.test.ts > "$out/direct-$round.log" 2>&1
    echo "$version direct-$round exit=$?" >> "$root/runtime-results/exits.txt"
  done
  PROBE_TRACE=1 node "$probe/prepare.mjs" "$tree" "$tree/runtime-trace"
  for shape in trace summary; do
    PROBE_SUMMARY=$([ "$shape" = summary ] && echo 1) PROBE_TRACE="$out/$shape" PROBE_INSTRUMENT="$probe/instrument.mjs" timeout 600 "$root/node_modules/.bin/vitest" run --config runtime-trace/vitest.config.mjs runtime-trace/claude.test.ts > "$out/$shape.log" 2>&1
    echo "$version $shape exit=$?" >> "$root/runtime-results/exits.txt"
  done
 done
