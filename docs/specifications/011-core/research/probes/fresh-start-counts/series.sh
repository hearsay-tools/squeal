#!/bin/sh
# 011-223 probe: fresh starts in turn, each only once the one-minute load is at or below 24; logs the wait.
# usage: series.sh <clone>:<store dir>:<label> ...
S=/tmp/fsc223
for spec in "$@"; do
  name=${spec%%:*}; rest=${spec#*:}; stores=${rest%%:*}; label=${rest#*:}
  w0=$(date +%s)
  while [ "$(awk '{print ($1 > 24)}' /proc/loadavg)" = 1 ]; do sleep 5; done
  echo "$(date +%s%3N) 0 0 waited $label $(( $(date +%s) - w0 ))s" >> $S/an/steps.log
  $S/runstart.sh $name $stores $label
done
echo "$(date +%s%3N) 0 0 series-done" >> $S/an/steps.log
