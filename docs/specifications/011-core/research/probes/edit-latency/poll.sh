#!/bin/bash
# Polls the scratch daemon's status --json every 0.5 s into $1 until killed.
out=$1
cd /tmp/el115/clone
while true; do
  t=$(date +%s.%N)
  /tmp/el115/scripts/sq.sh status --json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);
const pick={t:+process.argv[1],rev:j.revision,refined:j.refinedRevision,rp:j.runnerPartPending,ph:j.testFilesByPhase,
out:JSON.stringify(j.outstanding).slice(0,1500),
pend:JSON.stringify(j.pendingTestFiles).slice(0,600),
runs:j.runsOpen};
console.log(JSON.stringify(pick));}catch(e){console.log(JSON.stringify({t:+process.argv[1],err:String(e)}))}})' "$t" >> "$out"
  sleep 0.5
done
