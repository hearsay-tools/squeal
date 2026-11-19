#!/bin/bash
# progress.sh [from ms]: a one-line summary of the runs since <from> and the
# last sampler line of every *.tsv in $OUT.
. "$(dirname "$0")/env.sh"
node "$(dirname "$0")/analyze.mjs" .git/squeal/store.sqlite "${1:-0}" 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
console.log(JSON.stringify({runs:j.runs,byState:j.byState,distinctFinished:j.distinctFinished,meanOpen:j.meanOpenRuns,busyWallS:Math.round(j.busyWallMs/1000),lastEndS:Math.round(j.lastEndMs/1000)}))})'
for f in "$OUT"/*.tsv; do echo "$(basename "$f") $(tail -1 "$f")"; done
uptime
