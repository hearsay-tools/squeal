#!/bin/sh
# rounds.sh <root> <test> <case> <n> <modes...>: n rounds of the given modes through measure.mjs.
root=$1; test=$2; case=$3; n=$4; shift 4
out=/tmp/sq172/$(basename "$root").jsonl
i=0; while [ $i -lt "$n" ]; do for m in "$@"; do
  node --disable-warning=ExperimentalWarning /tmp/sq172/measure.mjs --root "$root" --test "$test" --edit "$test" --out "$out" --wait-ms 900000 --case "$case" --mode "$m"; sleep 1
done; i=$((i+1)); done
