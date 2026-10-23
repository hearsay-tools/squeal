#!/bin/bash
# Task 011-122: every 5 s, the load average and how many locked full runs (`npm exec vitest run
# --maxWorkers=4`, under the full-run flock) are alive, until <results>/<label>/stop exists.
# Usage: RESULTS=<dir> load-sampler.sh <label>
R=${RESULTS:?a results directory}/$1
mkdir -p "$R"
while [ ! -e "$R/stop" ]; do
  full=$(ps -eo args | grep -c '^npm exec vitest run --maxWorkers=4')
  echo "$(date -u +%s) $(cut -d' ' -f1-3 /proc/loadavg) full=$full" >> "$R/load.log"
  sleep 5
done
