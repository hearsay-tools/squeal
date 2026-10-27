#!/bin/sh
# 015-14 Round 3: waits until the one-minute load is at or under the CPU
# count, re-reading every 5 minutes and logging each hold with its time and
# load. Exits 2, logging the step as not measured, once the deadline passes.
# Round 2's gate.sh with the limit read from nproc, not fixed at 24.
# Usage: gate.sh <step> <log> <deadline, epoch seconds>
step=$1; log=$2; deadline=$3
cpus=$(nproc)
while :; do
  l=$(cut -d' ' -f1 /proc/loadavg)
  if [ "$(echo "$l <= $cpus" | bc)" = 1 ]; then
    echo "$(date -u +%FT%TZ) $step starts at load $l on $cpus CPUs" >> "$log"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "$(date -u +%FT%TZ) $step not measured: load $l at the deadline" >> "$log"
    exit 2
  fi
  echo "$(date -u +%FT%TZ) hold $step: load $l" >> "$log"
  sleep 300
done
