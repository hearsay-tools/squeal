#!/bin/sh
# E2 (shape 1): a hung tier while the daemon is paused 75 s (stale heartbeat),
# then while the daemon is killed without shutdown; what status says; what a restart clears.
# Usage: e2-death.sh <fixture> <out-dir>. Run after E1 (estimates exist).
. "$(dirname "$0")/env.sh"; . $W/lib.sh
FIXT=$1; OUT=$2; mkdir -p "$OUT"; cd "$FIXT"
node $W/observe.mjs "$FIXT/.git" "$OUT/observe.jsonl" 900 2000 & OBS=$!
trap 'kill $OBS 2>/dev/null; rm -f "$FIXT/hang.on"; timeout 90 sq stop --until-start >/dev/null 2>&1' EXIT
daemon_pid() { pgrep -u "$(id -u)" -f "squeal.mjs.*daemon.*$FIXT" | head -1; }
tree() { ps -eo pid,ppid,pgid,stat,etime,pcpu,args --forest | grep -E "squeal|vitest|node" | grep -v -E "grep|observe.mjs" | cut -c1-160 > "$OUT/$1.ps"; }
log "load $(cat /proc/loadavg)"
sqt 60 start start
touch hang.on; printf 'export const shared = 3;\n' > src/shared.ts; log "edit shared=3 with hang.on"
sleep 25
sqt 30 a-hang-json status --json test/hang.test.ts; pick "$OUT/a-hang-json.out" >> "$OUT/picks.jsonl"
D=$(daemon_pid); log "daemon pid $D"; tree a-tree
kill -STOP "$D"; log "daemon stopped (SIGSTOP)"
sleep 75
sqt 30 b-paused-json status --json test/hang.test.ts; pick "$OUT/b-paused-json.out" >> "$OUT/picks.jsonl"
sqt 30 b-paused-text status test/hang.test.ts
kill -CONT "$D"; log "daemon continued"
sleep 10
sqt 30 c-resumed-json status --json test/hang.test.ts; pick "$OUT/c-resumed-json.out" >> "$OUT/picks.jsonl"
tree c-tree
kill -KILL "$D"; log "daemon killed (SIGKILL)"
sleep 5; tree d-tree
sqt 30 d-dead-json status --json test/hang.test.ts; pick "$OUT/d-dead-json.out" >> "$OUT/picks.jsonl"
sqt 30 d-dead-text status test/hang.test.ts
sqt 30 d-dead-full status --full
sqt 90 e-start start
sleep 10; tree e-tree
sqt 30 e-hang-json status --json test/hang.test.ts; pick "$OUT/e-hang-json.out" >> "$OUT/picks.jsonl"
rm -f hang.on; log "hang.on removed"
sqt 300 e-hang-wait status --wait 240000 test/hang.test.ts
tree f-tree
log "done; load $(cat /proc/loadavg)"
