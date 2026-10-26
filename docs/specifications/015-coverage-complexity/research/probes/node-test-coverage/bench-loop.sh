#!/usr/bin/env bash
# Throwaway (015-76): rounds of bench.mjs, modes rotated each round, each run started only while
# the one-minute load is at most 24 (the brief's rule). One line per run in <result>:
# round, mode, load at start, /usr/bin/time wall/user/sys, then bench.mjs's JSON.
# usage: bench-loop.sh <work> <out> <result> [rounds=5] [concurrency=4]
set -u
here=$(cd "$(dirname "$0")" && pwd)
work=$1 out=$2 result=$3 rounds=${4:-5} conc=${5:-4}
modes=(off raw drop event)
for ((r = 0; r < rounds; r++)); do
  for ((k = 0; k < 4; k++)); do
    mode=${modes[$(((k + r) % 4))]}
    for ((w = 0; w < 120; w++)); do
      load=$(cut -d' ' -f1 /proc/loadavg)
      awk -v l="$load" 'BEGIN { exit !(l <= 24) }' && break
      sleep 15
    done
    awk -v l="$load" 'BEGIN { exit !(l <= 24) }' || { echo "round $r $mode skipped: load $load" >>"$result"; continue; }
    times=$( { /usr/bin/time -f '%e %U %S' node "$here/bench.mjs" "$mode" "$here/sample.tsv" "$work" "$out/$mode-$r" "$conc" >"$out/$mode-$r.json"; } 2>&1 | tail -1)
    echo "$r $mode load=$load time=$times $(cat "$out/$mode-$r.json")" >>"$result"
  done
done
echo done >>"$result"
