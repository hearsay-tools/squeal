#!/bin/sh
# E3d (shape 3): A runs a hung tier at key K. B misses the same edit (daemon stopped, lookup-only
# start leaves the file stale and unqueued), then asks for it with `run tests <file>` (a narrow
# ask, neither an edit's work nor forced), then a named wait; B restarts at about 60 s.
# Usage: e3d-claim.sh <fixture> <out-dir> <shared-value>.
. "$(dirname "$0")/env.sh"; . $W/lib.sh
A=$1; OUT=$2; V=$3; B=$A-b; mkdir -p "$OUT"
node $W/observe.mjs "$A/.git" "$OUT/observe.jsonl" 1500 2000 & OBS=$!
trap 'kill $OBS 2>/dev/null; rm -f "$A/hang.on" "$B/hang.on"; (cd "$B" && timeout 90 sq stop --until-start >/dev/null 2>&1); (cd "$A" && timeout 90 sq stop --until-start >/dev/null 2>&1)' EXIT
log "load $(cat /proc/loadavg)"
cd "$B"; sqt 60 b-stop0 stop --until-start
cd "$A"; sqt 60 a-start start
touch hang.on; printf 'export const shared = %s;\n' $V > src/shared.ts; log "A: edit shared=$V with hang.on"
sleep 10
snap() { sqt 30 "$1" status --json test/hang.test.ts; pick "$OUT/$1.out" | sed "s/^/{\"n\":\"$1\",\"t\":\"$(ts)\",\"dt\":$(( $(date +%s) - ${T0:-$(date +%s)} )),\"p\":/;s/\$/}/" >> "$OUT/picks.jsonl"; }
snap a-hang
cd "$B"; printf 'export const shared = %s;\n' $V > src/shared.ts; sqt 60 b-start1 start
T0=$(date +%s); snap b0
sqt 90 b-run run tests test/hang.test.ts --wait 30000; snap b1
sqt 30 b1-text status test/hang.test.ts
log "B: restart at $(( $(date +%s) - T0 )) s"
sqt 120 b-stop stop; sqt 60 b-start2 start; snap b2
i=0; while [ $i -lt 6 ]; do
  sqt 90 b-wait-$i status --wait 40000 test/hang.test.ts && break
  snap b3-$i; i=$((i + 1))
done
log "B: verdict or give-up at $(( $(date +%s) - T0 )) s"
sqt 30 b-end-text status test/hang.test.ts
cd "$A"; snap a-end
log "done; load $(cat /proc/loadavg)"
