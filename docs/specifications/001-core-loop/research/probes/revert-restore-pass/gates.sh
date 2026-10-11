#!/usr/bin/env bash
# gates.sh <n>: n full gates (--maxWorkers=4) of the instrumented copy, the probes inside; load sampled every 30 s.
set -u
B=/home/agent/projects/squeal/.ai/cezar/tmp/7cc74051-a5f8-4bc5-8b9f-ef0d83ee8de8
cd $B/rr
export SQ_PROBE_OUT=$B/out-gate GIT_CONFIG_GLOBAL=/dev/null; unset CODEX_SESSION_ID
mkdir -p $SQ_PROBE_OUT
( while true; do echo "$(date -Is) $(cut -d' ' -f1-3 /proc/loadavg)" >> $SQ_PROBE_OUT/load.log; sleep 30; done ) &
sampler=$!
for i in $(seq 1 "$1"); do
  echo "$(date -Is) gate $i start load $(cut -d' ' -f1-3 /proc/loadavg)" >> $SQ_PROBE_OUT/rounds.log
  npx vitest run --maxWorkers=4 > $SQ_PROBE_OUT/gate-$i.log 2>&1
  echo "$(date -Is) gate $i end exit $? load $(cut -d' ' -f1-3 /proc/loadavg) $(grep -E 'Test Files' $SQ_PROBE_OUT/gate-$i.log | tr -s ' ')" >> $SQ_PROBE_OUT/rounds.log
done
kill $sampler
