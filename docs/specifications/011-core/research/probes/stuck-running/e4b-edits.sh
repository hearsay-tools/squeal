#!/bin/sh
# E4b (shape 2) on the cezar fixture: an agent-like stream of edits to central modules, one
# every 3 s for 60 s; samples revision against listed (refined) revision, open runs, and a
# named wait for a known test file. Usage: e4b-edits.sh <fixture> <out-dir> <known-test> <file>...
. "$(dirname "$0")/env.sh"; . $W/lib.sh
FIXT=$1; OUT=$2; KNOWN=$3; shift 3; mkdir -p "$OUT"; cd "$FIXT"
node $W/observe.mjs "$FIXT/.git" "$OUT/observe.jsonl" 900 1000 & OBS=$!
trap 'kill $OBS 2>/dev/null; git checkout -q -- "$@"; timeout 90 sq stop --until-start >/dev/null 2>&1' EXIT
log "load $(cat /proc/loadavg)"
sqt 60 start start; sqt 300 settle status --wait 120000
log "edits begin"
( i=0; while [ $i -lt 20 ]; do for f in "$@"; do printf '\n// probe edit %s\n' $i >> "$f"; done; sleep 3; i=$((i + 1)); done ) &
EDITS=$!
sleep 10
sqt 90 wait-during status --wait 60000 "$KNOWN"; pick "$OUT/wait-during.out" >> "$OUT/picks.jsonl" 2>/dev/null
wait $EDITS; log "edits end"
sqt 200 wait-after status --wait 180000 "$KNOWN"
log "done; load $(cat /proc/loadavg)"
