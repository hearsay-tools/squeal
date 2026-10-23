#!/usr/bin/env bash
# Row 009-31: <rounds> runs of fresh-probe.test.ts (PROBE_N fresh workers each) in
# the probe copy, appending to $RESULTS/<label>.jsonl; every 4th round plain. With
# LATENCY=1, each round then runs the copy's latency.test.ts once, to latency.log.
# Usage: COPY=<copy> RESULTS=<dir> [LATENCY=1] probe-loop.sh <label> <rounds> [gap s]
set -u
label=$1 rounds=$2 gap=${3:-20}
for ((i = 1; i <= rounds; i++)); do
  plain=0
  ((i % 4 == 0)) && plain=1
  (cd "$COPY" && PROBE_PLAIN=$plain PROBE_LABEL="$label-$i" PROBE_OUT="$RESULTS/$label.jsonl" \
    npx vitest run test/harness/pi/fresh-probe.test.ts >>"$RESULTS/$label.log" 2>&1)
  echo "$(date -u +%H:%M:%S) round $i plain=$plain exit $?" >>"$RESULTS/$label.log"
  if [[ ${LATENCY:-0} == 1 ]]; then
    echo "=== $(date -u +%H:%M:%S) $label round $i" >>"$RESULTS/$label-latency.log"
    (cd "$COPY" && npx vitest run test/harness/pi/latency.test.ts --silent=false >>"$RESULTS/$label-latency.log" 2>&1)
    echo "=== exit $?" >>"$RESULTS/$label-latency.log"
  fi
  sleep "$gap"
done
