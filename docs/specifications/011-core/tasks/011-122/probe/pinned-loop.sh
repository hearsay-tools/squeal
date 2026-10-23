#!/bin/bash
# Task 011-122: probe-loop.sh with the fixture daemon's process tree pinned to CPUS, beside HOGS busy loops there.
# Usage: PROBE_ROOT=<copy> RESULTS=<dir> CPUS=22,23 HOGS=2 [SLOW=ms] pinned-loop.sh <label> <repeat> [rounds]
pids=()
for i in $(seq 1 "${HOGS:-2}"); do
  taskset -c "${CPUS:-22,23}" sh -c 'while :; do :; done' &
  pids+=($!)
done
PROBE_TASKSET="${CPUS:-22,23}" "$(dirname "$0")/probe-loop.sh" "$@"
kill "${pids[@]}"
