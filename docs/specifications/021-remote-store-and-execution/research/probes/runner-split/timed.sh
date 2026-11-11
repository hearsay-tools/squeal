#!/usr/bin/env bash
# Throwaway (row 021-04): the timing runs of Q4. Each mode starts only when the one-minute load
# is below 24 (the brief's rule); it checks every 30 s for up to $WAIT_MIN minutes, else gives up.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); . "$HERE/env.sh"
WAIT_MIN=${WAIT_MIN:-120}
below() { awk '{exit !($1 < 24)}' /proc/loadavg; }
for mode in local remote; do
  deadline=$(( $(date +%s) + WAIT_MIN*60 ))
  until below; do
    [ "$(date +%s)" -gt "$deadline" ] && { echo "$mode: not measured, load stayed at or above 24 ($(cut -d' ' -f1-3 /proc/loadavg))"; continue 2; }
    sleep 30
  done
  "$HERE/reset.sh"
  echo "$mode: start at $(date -u +%FT%TZ), load $(cut -d' ' -f1-3 /proc/loadavg)"
  node "$HERE/driver.mjs" $mode 5 --observe > /dev/null 2>&1 && echo "$mode: done, load $(cut -d' ' -f1-3 /proc/loadavg)"
done
"$HERE/reset.sh"
