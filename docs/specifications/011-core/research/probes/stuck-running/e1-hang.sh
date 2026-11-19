#!/bin/sh
# E1 (shapes 1 and 2): one file blocks its Vitest worker inside a tier while an
# edit re-keys all 1,201 files; then a new test file needs listing; then restart.
# Usage: e1-hang.sh <fixture> <out-dir>. Every call is bounded; the daemon is stopped at the end.
. "$(dirname "$0")/env.sh"; . $W/lib.sh
FIXT=$1; OUT=$2; mkdir -p "$OUT"; cd "$FIXT"
node $W/observe.mjs "$FIXT/.git" "$OUT/observe.jsonl" 1500 2000 & OBS=$!
trap 'kill $OBS 2>/dev/null; rm -f "$FIXT/hang.on"; timeout 90 sq stop --until-start >/dev/null 2>&1' EXIT
log "load $(cat /proc/loadavg)"
sqt 60 start start
# Baseline: every file once, so each has a duration estimate.
sqt 900 baseline run --all --wait 600000
sqt 30 counts0 status
# Stage A: hang one file, then re-key every file with one edit.
touch hang.on
printf 'export const shared = 2;\n' > src/shared.ts
log "edit: shared.ts changed, hang.on present"
sleep 20
sqt 30 a-hang-json status --json test/hang.test.ts; pick "$OUT/a-hang-json.out" >> "$OUT/picks.jsonl"
sqt 90 a-known-wait status --wait 60000 test/gen/f0007.test.ts
sqt 30 a-known-json status --json test/gen/f0007.test.ts; pick "$OUT/a-known-json.out" >> "$OUT/picks.jsonl"
sqt 30 a-232 status --wait 1000 test/gen/f0007.test.ts
# Stage B: a new test file: its revision must be listed while the hung tier runs.
cp test/gen/f0001.test.ts test/gen/new0001.test.ts; sed -i 's/"f1"/"new1"/' test/gen/new0001.test.ts
log "added test/gen/new0001.test.ts"
sleep 5
sqt 30 b-known-json status --json test/gen/f0009.test.ts; pick "$OUT/b-known-json.out" >> "$OUT/picks.jsonl"
sqt 90 b-run-known run tests test/gen/f0009.test.ts --wait 60000
sqt 90 b-new-wait status --wait 60000 test/gen/new0001.test.ts
sqt 30 b-hang-json status --json test/hang.test.ts; pick "$OUT/b-hang-json.out" >> "$OUT/picks.jsonl"
# Watch the hung file across its timeout and splits, sampling every 30 s for up to 10 min.
i=0; while [ $i -lt 20 ]; do
  sqt 30 c-hang-$i status --json test/hang.test.ts; pick "$OUT/c-hang-$i.out" >> "$OUT/picks.jsonl"
  tr -d " \n" < "$OUT/c-hang-$i.out" | grep -q "\"state\":\"pending\"" || break
  sleep 30; i=$((i + 1))
done
sqt 30 c-hang-text status test/hang.test.ts
# Stage D: restart with the marker still present, then remove it.
sqt 120 d-stop stop
sqt 60 d-start start
sleep 15
sqt 30 d-hang-json status --json test/hang.test.ts; pick "$OUT/d-hang-json.out" >> "$OUT/picks.jsonl"
rm -f hang.on; log "hang.on removed"
sqt 300 d-hang-wait status --wait 240000 test/hang.test.ts
sqt 30 d-why why test/hang.test.ts
log "done; load $(cat /proc/loadavg)"
