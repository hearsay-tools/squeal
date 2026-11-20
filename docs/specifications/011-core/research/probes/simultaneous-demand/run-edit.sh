#!/bin/bash
# run-edit.sh <label> <daemon pid> <scope unit> <path> [max s]: start the
# samplers (load and CPU every 5 s, queue and heartbeat every 2 s, Vitest
# workers and held pool permits every 1 or 2 s), edit <path> once, then wait
# until the daemon is idle (HELD=1: the run-loop group left out) or [max s]
# (default 4500) pass. Writes $OUT/<label>.{tsv,queue.tsv,workers.tsv,
# permits.txt,edits.tsv,t0,t1}. 011-395's, plus the worker and permit samplers.
. "$(dirname "$0")/env.sh"
label=$1; dpid=$2; unit=$3; path=$4; max=${5:-4500}
d=$(cd "$(dirname "$0")" && pwd)
cg=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope
bash "$d/bg.sh" "$label-sampler" $((max+300)) bash "$d/sample.sh" "$OUT/$label.tsv" $((max+200)) "$cg" "$dpid"
bash "$d/bg.sh" "$label-queue" $((max+300)) node "$d/queue-sample.mjs" .git/squeal/store.sqlite "$OUT/$label.queue.tsv" $((max+200))
bash "$d/bg.sh" "$label-workers" $((max+300)) node "$d/workers.mjs" "$OUT/$label.workers.tsv" $((max+200)) "$cg"
bash "$d/bg.sh" "$label-permits" $((max+300)) bash -c "end=\$((\$(date +%s)+$max+200)); while [ \$(date +%s) -lt \$end ]; do echo \"\$(date +%s%3N) \$(lslocks -n -o PATH 2>/dev/null | grep -c '$P/xdg/squeal/pool')\"; sleep 2; done > $OUT/$label.permits.txt"
sleep 15   # an idle baseline before the edit
date +%s%3N > "$OUT/$label.t0"
bash "$d/edit.sh" "$label" "$path"
sleep 40   # let the revision land before the idle check can see an empty queue
bash "$d/wait-idle.sh" "$max"
date +%s%3N > "$OUT/$label.t1"
for n in sampler queue workers permits; do kill "$(cat "$OUT/$label-$n.pid")" 2>/dev/null; done
echo "done $label"
