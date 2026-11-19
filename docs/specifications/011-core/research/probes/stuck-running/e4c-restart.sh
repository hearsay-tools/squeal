#!/bin/sh
# E4c (shape 2): after E4b stopped its daemon with revisions still unlisted, start one and time
# how long until the latest revision is listed and a tier starts. Usage: e4c-restart.sh <fixture> <out-dir>.
. "$(dirname "$0")/env.sh"; . $W/lib.sh
FIXT=$1; OUT=$2; mkdir -p "$OUT"; cd "$FIXT"
node $W/observe.mjs "$FIXT/.git" "$OUT/observe.jsonl" 300 1000 & OBS=$!
trap 'kill $OBS 2>/dev/null; git checkout -q -- packages; timeout 90 sq stop --until-start >/dev/null 2>&1' EXIT
log "load $(cat /proc/loadavg)"
sleep 2; sqt 60 start start
sqt 200 wait status --wait 150000 packages/cezar/src/delegation/settled-observation.test.ts
log "done; load $(cat /proc/loadavg)"
