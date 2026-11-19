#!/bin/sh
# E3 (shape 3): worktree A runs a hung tier at key K; worktree B reaches K while its daemon
# is stopped, then starts (its files are not an edit's work, so C7 lets them wait on A's claim);
# B restarts part way. Measures how long B waits and what B's status says.
# Usage: e3-claim.sh <fixture> <out-dir>. Run after E1 (A has estimates).
. "$(dirname "$0")/env.sh"; . $W/lib.sh
A=$1; OUT=$2; B=$A-b; mkdir -p "$OUT"
cd "$A"; [ -d "$B" ] || { git worktree add -q --detach "$B" HEAD; (cd "$B" && pnpm install --offline --silent >/dev/null 2>&1); }
node $W/observe.mjs "$A/.git" "$OUT/observe.jsonl" 1500 2000 & OBS=$!
trap 'kill $OBS 2>/dev/null; rm -f "$A/hang.on" "$B/hang.on"; (cd "$B" && timeout 90 sq stop --until-start >/dev/null 2>&1); (cd "$A" && timeout 90 sq stop --until-start >/dev/null 2>&1)' EXIT
log "load $(cat /proc/loadavg)"
cd "$B"; sqt 60 b-start0 start; sqt 300 b-base run --all --wait 240000; sqt 90 b-stop0 stop --until-start
cd "$A"; sqt 60 a-start start
touch hang.on; printf 'export const shared = 4;\n' > src/shared.ts; log "A: edit shared=4 with hang.on"
sleep 25
sqt 30 a-hang-json status --json test/hang.test.ts; pick "$OUT/a-hang-json.out" >> "$OUT/picks.jsonl"
cd "$B"; printf 'export const shared = 4;\n' > src/shared.ts; log "B: edit shared=4 while its daemon is stopped"
T0=$(date +%s)
sqt 60 b-start1 start
i=0; while [ $i -lt 6 ]; do
  sleep 10
  sqt 30 b1-$i status --json test/hang.test.ts; pick "$OUT/b1-$i.out" >> "$OUT/picks.jsonl"
  tr -d ' \n' < "$OUT/b1-$i.out" | grep -q '"state":"pending"' || break; i=$((i + 1))
done
sqt 30 b1-text status test/hang.test.ts
log "B: restart at $(( $(date +%s) - T0 )) s after its edit"
sqt 120 b-stop1 stop
sqt 60 b-start2 start
i=0; while [ $i -lt 30 ]; do
  sleep 10
  sqt 30 b2-$i status --json test/hang.test.ts; pick "$OUT/b2-$i.out" >> "$OUT/picks.jsonl"
  tr -d ' \n' < "$OUT/b2-$i.out" | grep -q '"state":"pending"' || break; i=$((i + 1))
done
log "B: hang.test.ts left pending at $(( $(date +%s) - T0 )) s after its edit"
sqt 30 b2-text status test/hang.test.ts
cd "$A"; sqt 30 a-end-json status --json test/hang.test.ts; pick "$OUT/a-end-json.out" >> "$OUT/picks.jsonl"
log "done; load $(cat /proc/loadavg)"
