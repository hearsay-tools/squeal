#!/bin/sh
# Throwaway. One `opencode run` as squeal-e2e.
# Usage: run.sh <label> <dir: repo|wt> <PROBE_WAKE> <PROBE_SPAWN 0|1> <prompt> [opencode run args...]
set -u
. "$(dirname "$0")/env.sh"
label=$1 dir=$2 wake=$3 spawn=$4 prompt=$5
shift 5
cd $W/$dir && mkdir -p sub && cd ${SUBDIR:-.}
[ -n "${CFGDIR:-}" ] && export OPENCODE_CONFIG_DIR=$W/probe/cfgdir
export PROBE_LABEL=$label PROBE_WAKE=$wake PROBE_SPAWN=$spawn
start=$(date +%s%3N)
echo "{\"label\":\"$label\",\"kind\":\"run.start\",\"at\":$start}" >> $PROBE_LOG
opencode run --format json -m $MODEL "$@" "$prompt" </dev/null > $W/log/$label.stdout.jsonl 2> $W/log/$label.stderr.txt
code=$?
end=$(date +%s%3N)
echo "{\"label\":\"$label\",\"kind\":\"run.exit\",\"code\":$code,\"at\":$end}" >> $PROBE_LOG
echo "exit=$code ms=$((end-start))"
