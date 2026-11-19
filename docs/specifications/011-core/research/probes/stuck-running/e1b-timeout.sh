#!/bin/sh
# E1b (shapes 1 and 2), no named wait (so no promotion and no yield): one file blocks its
# worker inside an edit tier; a new test file then needs its revision listed; a narrow
# `run tests <known file>` asks meanwhile. Watches the tier to its timeout (runner.timeoutMs
# 120 s here) and the split re-runs. Usage: e1b-timeout.sh <fixture> <out-dir>.
. "$(dirname "$0")/env.sh"; . $W/lib.sh
FIXT=$1; OUT=$2; mkdir -p "$OUT"; cd "$FIXT"
node $W/observe.mjs "$FIXT/.git" "$OUT/observe.jsonl" 1500 2000 & OBS=$!
trap 'kill $OBS 2>/dev/null; rm -f "$FIXT/hang.on"; timeout 90 sq stop --until-start >/dev/null 2>&1' EXIT
log "load $(cat /proc/loadavg)"
sqt 60 start start
sqt 600 settle status --wait 300000
touch hang.on; printf 'export const shared = 5;\n' > src/shared.ts; log "edit shared=5 with hang.on"
# Snapshots only (status --json without --wait promotes nothing), every 15 s until hang.test.ts settles.
i=0; while [ $i -lt 60 ]; do
  sleep 15
  sqt 30 s-$i status --json test/hang.test.ts; pick "$OUT/s-$i.out" | sed "s/^/{\"i\":$i,\"t\":\"$(ts)\",\"p\":/;s/\$/}/" >> "$OUT/picks.jsonl"
  if [ $i -eq 2 ]; then
    cp test/gen/f0002.test.ts test/gen/new0002.test.ts; sed -i 's/"f2"/"new2"/' test/gen/new0002.test.ts
    log "added test/gen/new0002.test.ts"
  fi
  if [ $i -eq 3 ]; then sqt 90 run-known run tests test/gen/f0011.test.ts --wait 60000; fi
  if [ $i -eq 8 ]; then sqt 30 text-8 status test/hang.test.ts; fi
  tr -d ' \n' < "$OUT/s-$i.out" | grep -q '"state":"pending"' || break
  i=$((i + 1))
done
log "hang.test.ts settled or gave up at i=$i"
sqt 30 why why test/hang.test.ts
log "done; load $(cat /proc/loadavg)"
