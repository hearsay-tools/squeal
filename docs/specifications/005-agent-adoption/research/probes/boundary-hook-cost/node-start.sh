#!/bin/sh
# Throwaway, row 005-110 (from 005-101). Wall time of the real post-tool-batch and stop bundles
# through hooks/run with an input whose cwd is outside any git worktree (Node start, bundle load,
# input parse, locate, exit: no store is opened). N runs each, interleaved; prints ms and load.
# Usage: node-start.sh <plugin-dir> <N>
d=$1 n=$2
ms() { s=$(date +%s%N); "$@" >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e - s) / 1000000 )); }
i=0
while [ $i -lt "$n" ]; do
  a=$(cd / && ms sh -c "echo '{\"session_id\":\"probe\",\"hook_event_name\":\"PostToolBatch\",\"cwd\":\"/\"}' | $d/hooks/run node --disable-warning=ExperimentalWarning $d/dist/post-tool-batch.mjs")
  b=$(cd / && ms sh -c "echo '{\"session_id\":\"probe\",\"hook_event_name\":\"Stop\",\"cwd\":\"/\"}' | $d/hooks/run node --disable-warning=ExperimentalWarning $d/dist/stop.mjs")
  echo "$a $b $(cut -d' ' -f1 /proc/loadavg)"
  i=$((i + 1))
done
