#!/bin/bash
# poll.sh <clone> <out>: status --json every second into <out>, reduced to revision, refinement,
# phases, open runs and the outstanding entries other than never-run files. Reads the store only.
cd "$1"; out=$2; P=$(dirname "$(readlink -f "$0")")
while true; do
  "$P/sq.sh" status --json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);
const o=(j.outstanding||[]).filter(x=>x.standing?.kind!=="never-run").map(x=>JSON.stringify(x).slice(0,400));
console.log(JSON.stringify({t:Date.now()/1000,rev:j.revision,refined:j.refinedRevision,rp:j.runnerPartPending,ph:j.testFilesByPhase,runs:j.runsOpen,out:o}));}catch(e){}})' >> "$out"
  sleep 1
done
