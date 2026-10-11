#!/usr/bin/env bash
# rounds.sh <label> <n> <vitest paths...>: n rounds of the probe beside other files, load logged per round.
set -u
label=$1; n=$2; shift 2
cd /home/agent/projects/squeal/.ai/cezar/tmp/7cc74051-a5f8-4bc5-8b9f-ef0d83ee8de8/rr
export SQ_PROBE_OUT=${SQ_PROBE_OUT:-/home/agent/projects/squeal/.ai/cezar/tmp/7cc74051-a5f8-4bc5-8b9f-ef0d83ee8de8/out}
export GIT_CONFIG_GLOBAL=/dev/null; unset CODEX_SESSION_ID
R=$SQ_PROBE_OUT/rounds.log
for i in $(seq 1 "$n"); do
  echo "$(date -Is) $label round $i start load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$R"
  npx vitest run "$@" --maxWorkers=4 > "$SQ_PROBE_OUT/round-$label-$i.log" 2>&1
  echo "$(date -Is) $label round $i end exit $? load $(cut -d' ' -f1-3 /proc/loadavg) $(grep -E 'Test Files' "$SQ_PROBE_OUT/round-$label-$i.log" | tr -s ' ')" >> "$R"
done
