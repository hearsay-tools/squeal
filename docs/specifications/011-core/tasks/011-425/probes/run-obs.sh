#!/bin/bash
# usage: run-obs.sh <label> <list file> — runs each test file alone in the copy under
# Squeal's recorder (SQUEAL_OBSERVE, per-file out dir) and the stack tracer.
S4=${PROBE:?set PROBE to the probe directory}; T=$S4/tree; L=$1
mkdir -p $S4/$L
while read -r f; do
  [ -z "$f" ] && continue
  d=$S4/$L/obs/$(echo "$f" | tr / _); mkdir -p $d
  start=$(date +%s.%N)
  ( cd $T && SQUEAL_OBSERVE="{\"out\":\"$d\",\"root\":\"$T/\"}" TRACE_ROOT=$T TRACE_LOG=$S4/$L/trace.ndjson TRACE_TEST=$f \
    NODE_OPTIONS="--require $T/src/runners/observe/recorder.cjs --require $S4/tracer.cjs" \
    timeout -k 10 400 node_modules/.bin/vitest run "$f" > $d.log 2>&1 )
  echo "{\"done\":\"$f\",\"exit\":$?,\"s\":$(echo "$(date +%s.%N) - $start" | bc)}" >> $S4/$L/done.ndjson
done < $2
