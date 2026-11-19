#!/bin/sh
# E3c (shape 3): A runs a hung tier at key K (hang.test.ts blocked). B makes the same edit plus
# ten more keyed paths in one revision, so its files are catch-up work, which waits on A's claim
# (C7; an edit's own files and forced files never wait). B names hang.test.ts in waits; B restarts
# at about 60 s. Measures when B runs the file itself and what its status says meanwhile.
# Usage: e3c-claim.sh <fixture> <out-dir> <shared-value>.
. "$(dirname "$0")/env.sh"; . $W/lib.sh
A=$1; OUT=$2; V=$3; B=$A-b; mkdir -p "$OUT"
node $W/observe.mjs "$A/.git" "$OUT/observe.jsonl" 1500 2000 & OBS=$!
trap 'kill $OBS 2>/dev/null; rm -f "$A/hang.on" "$B/hang.on"; (cd "$B" && git checkout -q -- test/gen; timeout 90 sq stop --until-start >/dev/null 2>&1); (cd "$A" && timeout 90 sq stop --until-start >/dev/null 2>&1)' EXIT
log "load $(cat /proc/loadavg)"
cd "$A"; sqt 60 a-start start
cd "$B"; sqt 60 b-start start
cd "$A"; touch hang.on; printf 'export const shared = %s;\n' $V > src/shared.ts; log "A: edit shared=$V with hang.on"
sleep 10
snap() { sqt 30 "$1" status --json test/hang.test.ts; pick "$OUT/$1.out" | sed "s/^/{\"n\":\"$1\",\"t\":\"$(ts)\",\"dt\":$(( $(date +%s) - ${T0:-$(date +%s)} )),\"p\":/;s/\$/}/" >> "$OUT/picks.jsonl"; }
snap a-hang
cd "$B"; printf 'export const shared = %s;\n' $V > src/shared.ts
for n in 0101 0102 0103 0104 0105 0106 0107 0108 0109 0110 0111; do printf '// catch-up %s\n' $V >> test/gen/f$n.test.ts; done
T0=$(date +%s); log "B: edit shared=$V plus 11 test files (daemon live)"
sleep 3; snap b0
sqt 90 b-wait1 status --wait 55000 test/hang.test.ts; snap b1
log "B: restart at $(( $(date +%s) - T0 )) s"
sqt 120 b-stop stop; sqt 60 b-start2 start
i=0; while [ $i -lt 6 ]; do
  sqt 90 b-wait2-$i status --wait 55000 test/hang.test.ts && break
  snap b2-$i; i=$((i + 1))
done
log "B: verdict or give-up at $(( $(date +%s) - T0 )) s"
snap b-end; sqt 30 b-end-text status test/hang.test.ts
cd "$A"; snap a-end
log "done; load $(cat /proc/loadavg)"
