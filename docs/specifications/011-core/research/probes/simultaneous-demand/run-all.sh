#!/bin/bash
# run-all.sh <mode> <label:arm>...: the timed runs in order (row 011-420).
# mode q4: two daemons (q4.sh <label> <arm> 2 packages/contract/src/live.ts);
# mode one: one daemon (arm.sh <label> <arm> packages/contract/src/ci-wait.ts).
# Before each run: wait until the one-minute load is under 1 and no process
# of another task's ~/work directory runs (checked every 15 s, at most 30 min);
# the reading is logged in $OUT/gate.log. Stops at the first run that fails
# or lasts under 2 min.
d=$(cd "$(dirname "$0")" && pwd)
mode=$1; shift
# bg.sh has already sourced env.sh, which moved HOME: keep its exported P
# (a first start rebuilt P from the moved HOME and ran nothing, 2026-11-19).
P=${P:-$HOME/work/0d5248b3}; OUT=$P/out; mkdir -p "$OUT"
[ -d "$P/squawk/.git/squeal" ] && [ -d "$P/q4-1/.git/squeal" ] || { echo "no clones under $P" >> "$OUT/gate.log"; exit 1; }
for la in "$@"; do
  label=${la%%:*}; arm=${la##*:}
  for i in $(seq 1 120); do
    l=$(cut -d' ' -f1 /proc/loadavg)
    n=$(ps -eo args | grep '/work/' | grep -v '0d5248b3\|grep' | wc -l)
    awk -v l="$l" -v n="$n" 'BEGIN{exit !(l<1.0 && n==0)}' && break
    sleep 15
  done
  echo "$(date -u +%FT%TZ) $label $arm load1=$l others=$n" >> "$OUT/gate.log"
  awk -v l="$l" -v n="$n" 'BEGIN{exit !(l<1.0 && n==0)}' || { echo "$label: VM not quiet, stop" >> "$OUT/gate.log"; exit 1; }
  if [ "$mode" = q4 ]; then
    bash "$d/q4.sh" "$label" "$arm" 2 packages/contract/src/live.ts > "$OUT/$label.run.log" 2>&1 || { echo "$label failed" >> "$OUT/gate.log"; exit 1; }
  else
    bash "$d/arm.sh" "$label" "$arm" packages/contract/src/ci-wait.ts > "$OUT/$label.run.log" 2>&1 || { echo "$label failed" >> "$OUT/gate.log"; exit 1; }
  fi
  ms=$(( $(cat "$OUT/$label.t1") - $(cat "$OUT/$label.t0") ))
  echo "$(date -u +%FT%TZ) $label done in $ms ms" >> "$OUT/gate.log"
  [ "$ms" -gt 120000 ] || { echo "$label: too short, stop" >> "$OUT/gate.log"; exit 1; }
done
echo "$(date -u +%FT%TZ) all done" >> "$OUT/gate.log"
