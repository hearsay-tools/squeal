#!/bin/sh
# Row 015-11, goal 9: alternate coverage off and on for N rounds, one fresh process each,
# with the one-minute load before each run.
# Usage: bench-loop.sh <squeal worktree> <project copy> <list file> <rounds> <out file>
here=$(cd "$(dirname "$0")" && pwd)
src=$1; root=$2; list=$3; rounds=$4; out=$5
i=0
while [ "$i" -lt "$rounds" ]; do
  for mode in off on; do
    tmp=$(mktemp -d /tmp/sq015-11/bench-tmp-XXXXXX)
    load=$(cut -d' ' -f1 /proc/loadavg)
    line=$(cd "$root" && /usr/bin/time -f "TIME wall=%e user=%U sys=%S maxrss_kb=%M" \
      timeout 900 "$src/node_modules/.bin/tsx" "$here/bench.mts" "$src" "$root" "$mode" "$list" "$tmp" 2>&1 \
      | grep -E '^RESULT|^TIME' | tr '\n' ' ')
    echo "round=$i load1=$load $line" >> "$out"
    rm -rf "$tmp"
  done
  i=$((i + 1))
done
