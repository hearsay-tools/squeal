#!/bin/sh
# Throwaway (015-01): alternate off / v8 / istanbul for N rounds on one sample,
# one fresh process each, with the one-minute load before each run.
# Usage: bench-loop.sh <repo copy> <list file> <rounds> <out file> [modes]
here=$(cd "$(dirname "$0")" && pwd)
root=$1; list=$2; rounds=$3; out=$4; modes=${5:-off v8 istanbul}
i=0
while [ $i -lt "$rounds" ]; do
  for m in $modes; do
    rm -rf "/tmp/sq015-rep/$m"
    load=$(cut -d' ' -f1 /proc/loadavg)
    line=$(cd "$root" && /usr/bin/time -f "TIME wall=%e user=%U sys=%S maxrss_kb=%M" \
      timeout 600 node "$here/bench.mjs" "$root/node_modules" "$root" "$m" "/tmp/sq015-rep/$m" "$list" 2>&1 | grep -E '^RESULT|^TIME' | tr '\n' ' ')
    echo "round=$i load1=$load $line" >> "$out"
  done
  i=$((i + 1))
done
