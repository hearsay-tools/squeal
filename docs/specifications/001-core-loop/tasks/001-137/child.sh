#!/usr/bin/env bash
# Task 001-137 evidence, not product code. The child that `artifacts/cli` and
# `discovery/cli` spawn under a 15 s deadline, `node --import tsx
# packages/cezar/src/index.ts artifact --help`, timed with and without the
# recorder in NODE_OPTIONS (as a Vitest worker's child inherits it), alternating.
# Prints mode, wall seconds, user+sys CPU seconds, observed paths.
# Usage: child.sh <clone> <rounds>
set -u
clone=$1; rounds=$2
here=$(cd "$(dirname "$0")" && pwd)
recorder=$(cd "$here/../../../../../src/runners/observe" && pwd)/recorder.cjs
unset_cez=$(env | grep -o '^CEZ_[A-Z_]*' | sed 's/^/-u /' | tr '\n' ' ')
for i in $(seq 1 "$rounds"); do
  if [ $((i % 2)) -eq 1 ]; then order="on off"; else order="off on"; fi
  for mode in $order; do
    out=$(mktemp -d)
    if [ "$mode" = on ]; then
      extra=(NODE_OPTIONS="--require \"$recorder\"" SQUEAL_OBSERVE="{\"out\":\"$out\",\"root\":\"$clone\",\"skip\":[],\"file\":\"$clone/packages/cezar/src/artifacts/cli.test.ts\"}")
    else
      extra=()
    fi
    t=$( (cd "$clone" && env $unset_cez "${extra[@]}" /usr/bin/time -f "%e %U %S" node --import tsx packages/cezar/src/index.ts artifact --help >/dev/null) 2>&1 | tail -1)
    paths=$(cat "$out"/*.ndjson 2>/dev/null | grep -o '"/[^"]*"' | sort -u | wc -l)
    echo "$mode $t $paths" | awk '{ printf "%s wall %.2f cpu %.2f paths %d\n", $1, $2, $3 + $4, $5 }'
    rm -rf "$out"
  done
done
