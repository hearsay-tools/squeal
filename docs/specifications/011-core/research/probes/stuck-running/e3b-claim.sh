#!/bin/sh
# E3b (shape 3): A runs a hung tier at key K; B makes the same edit while its daemon runs,
# then restarts at once (after a restart its queued files are not an edit's work, which C7
# lets wait on another worktree's claim); B restarts again later: does its wait start over?
# Usage: e3b-claim.sh <fixture> <out-dir> <shared-value>.
. "$(dirname "$0")/env.sh"; . $W/lib.sh
A=$1; OUT=$2; V=$3; B=$A-b; mkdir -p "$OUT"
node $W/observe.mjs "$A/.git" "$OUT/observe.jsonl" 1500 2000 & OBS=$!
trap 'kill $OBS 2>/dev/null; rm -f "$A/hang.on" "$B/hang.on"; (cd "$B" && timeout 90 sq stop --until-start >/dev/null 2>&1); (cd "$A" && timeout 90 sq stop --until-start >/dev/null 2>&1)' EXIT
log "load $(cat /proc/loadavg)"
cd "$A"; sqt 60 a-start start
cd "$B"; sqt 60 b-start start
cd "$A"; touch hang.on; printf 'export const shared = %s;\n' $V > src/shared.ts; log "A: edit shared=$V with hang.on"
sleep 10
sqt 30 a-hang-json status --json test/hang.test.ts; pick "$OUT/a-hang-json.out" >> "$OUT/picks.jsonl"
cd "$B"; printf 'export const shared = %s;\n' $V > src/shared.ts; T0=$(date +%s); log "B: edit shared=$V (daemon live)"
sleep 3
sqt 120 b-stop1 stop
sqt 60 b-start1 start; log "B: restarted at $(( $(date +%s) - T0 )) s"
snap() { sqt 30 "$1" status --json test/hang.test.ts; pick "$OUT/$1.out" | sed "s/^/{\"n\":\"$1\",\"t\":\"$(ts)\",\"dt\":$(( $(date +%s) - T0 )),\"p\":/;s/\$/}/" >> "$OUT/picks.jsonl"; }
i=0; while [ $i -lt 8 ]; do sleep 10; snap b1-$i; tr -d ' \n' < "$OUT/b1-$i.out" | grep -q '"state":"pending"' || break; i=$((i + 1)); done
sqt 30 b1-text status test/hang.test.ts
log "B: second restart at $(( $(date +%s) - T0 )) s"
sqt 120 b-stop2 stop; sqt 60 b-start2 start
i=0; while [ $i -lt 30 ]; do sleep 10; snap b2-$i; tr -d ' \n' < "$OUT/b2-$i.out" | grep -q '"state":"pending"' || break; i=$((i + 1)); done
log "B: hang.test.ts settled or gave up at $(( $(date +%s) - T0 )) s"
sqt 30 b2-text status test/hang.test.ts
cd "$A"; snap a-end
log "done; load $(cat /proc/loadavg)"
