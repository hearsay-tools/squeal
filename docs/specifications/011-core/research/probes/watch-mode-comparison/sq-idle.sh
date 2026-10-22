#!/bin/bash
# sq-idle.sh <clone> <timeout s>: waits until the clone's daemon has no test file queued or running
# and its revision is refined; prints the seconds waited. Reads status --json every 2 s.
cd "$1"; T0=$(date +%s.%N)
for i in $(seq 1 $(( $2 / 2 ))); do
  r=$("$(dirname "$0")/sq.sh" status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const p=j.testFilesByPhase||{};console.log((p.running||0)+(p.queued||0)===0&&!j.runnerPartPending&&j.refinedRevision===j.revision?"idle":"busy "+JSON.stringify(p))}catch(e){console.log("err")}})')
  [ "$r" = idle ] && { echo "idle after $(echo "$(date +%s.%N) - $T0" | bc) s"; exit 0; }
  sleep 2
done
echo "not idle after $2 s: $r"; exit 1
