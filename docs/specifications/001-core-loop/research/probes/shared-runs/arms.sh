#!/bin/sh
# PROBE 001-201 (throwaway): the three arms in sequence, each after the host's 1-minute load is under 30 (at most 10 min wait).
cd /tmp/sr201
R="/tmp/sr201/cz/main /tmp/sr201/cz/wt1 /tmp/sr201/cz/wt2 /tmp/sr201/cz/wt3"
for arm in "today base -" "proto proto -" "proto64 proto 64"; do
  set -- $arm
  i=0; while [ $(cut -d. -f1 /proc/loadavg) -ge 30 ] && [ $i -lt 120 ]; do sleep 5; i=$((i+1)); done
  { echo "start $(date +%T) loadavg $(cat /proc/loadavg)"; node probe/four.mjs /tmp/sr201/squeal-$2/dist/cli/index.js $1 $3 $R; } > probe/four-$1.out 2>&1
done
echo ALL-ARMS-DONE
