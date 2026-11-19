#!/bin/bash
# plain.sh <label> <prefix>: run the files of <prefix>.vitest.txt with plain
# `vitest run` (Vitest's default workers, no coverage, no Squeal), then the
# files of <prefix>.node-test.txt with plain `node --test` as squawk's
# test:unit scripts run them. /usr/bin/time gives each wall time and CPU-s
# (waited-for children included). Prints the
# result lines. No daemon may run tests meanwhile.
. "$(dirname "$0")/env.sh"
label=$1; prefix=$2
mapfile -t vfiles < <(cut -d' ' -f2- "$prefix.vitest.txt" | grep .)
projects=$(cut -d' ' -f1 "$prefix.vitest.txt" | sort -u | grep . | sed 's/^/--project /' | tr '\n' ' ')
# Vitest: CPU-s from /usr/bin/time (children included), wall from the timer.
/usr/bin/time -f "cpu_s=%U+%S wall=%e" -o "$OUT/$label.vitest.time" \
  timeout 3600 node_modules/.bin/vitest run $projects --reporter=dot --passWithNoTests "${vfiles[@]}" > "$OUT/$label.vitest.log" 2>&1
echo "vitest rc=$? $(cat "$OUT/$label.vitest.time" | tail -1) files=${#vfiles[@]}"
tail -6 "$OUT/$label.vitest.log"
# node:test: per project, as squawk's package.json runs them.
for proj in "test:unit" "root:test:unit"; do
  mapfile -t nfiles < <(grep "^$proj " "$prefix.node-test.txt" | cut -d' ' -f2-)
  [ ${#nfiles[@]} -eq 0 ] && continue
  if [ "$proj" = "test:unit" ]; then
    rel=(); for f in "${nfiles[@]}"; do rel+=("${f#packages/cezar/}"); done
    ( cd packages/cezar && /usr/bin/time -f "cpu_s=%U+%S wall=%e" -o "$OUT/$label.$proj.time" \
      timeout 1800 node --import ../../scripts/test-home-env.mjs --import tsx --test "${rel[@]}" > "$OUT/$label.$proj.log" 2>&1 )
  else
    /usr/bin/time -f "cpu_s=%U+%S wall=%e" -o "$OUT/$label.$proj.time" \
      timeout 1800 node --import ./scripts/test-home-env.mjs --test "${nfiles[@]}" > "$OUT/$label.$proj.log" 2>&1
  fi
  echo "$proj rc=$? $(tail -1 "$OUT/$label.$proj.time") files=${#nfiles[@]}"
done
