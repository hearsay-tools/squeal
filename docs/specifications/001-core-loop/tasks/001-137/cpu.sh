#!/usr/bin/env bash
# Task 001-137 evidence, not product code. CPU of one nine.ts run, its whole
# process tree (user + sys of every waited descendant), with and without the
# recorder, alternating, no burners. Prints mode, wall, cpu and the failing files.
# Usage: cpu.sh <clone> <out dir> <pairs>
set -u
clone=$1; out=$2; pairs=$3
here=$(cd "$(dirname "$0")" && pwd)
tsx=$here/../../../../../node_modules/.bin/tsx
unset_cez=$(env | grep -o '^CEZ_[A-Z_]*' | sed 's/^/-u /' | tr '\n' ' ')
nine=$(grep -o '^nine="[^"]*"' "$here/rounds.sh" | sed 's/^nine="//; s/"$//')
for i in $(seq 1 "$pairs"); do
  if [ $((i % 2)) -eq 1 ]; then order="on off"; else order="off on"; fi
  for mode in $order; do
    t=$( (cd "$clone" && env $unset_cez setsid -w /usr/bin/time -f "%e %U %S" "$tsx" "$here/nine.ts" "$clone" "$mode" "$out/cpu-$i-$mode.json" 23 $nine) 2>&1 | tail -1)
    echo "$mode $t" | awk '{ printf "%s wall %.1f cpu %.1f\n", $1, $2, $3 + $4 }'
  done
done
