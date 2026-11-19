#!/bin/bash
# run-edit.sh <label> <daemon pid> <scope unit> <path> [max s]: start the
# samplers, edit <path> once, then wait until the daemon is idle or [max s]
# (default 4500) pass. Writes $OUT/<label>.{tsv,queue.tsv,edits.tsv,t0}.
. "$(dirname "$0")/env.sh"
label=$1; dpid=$2; unit=$3; path=$4; max=${5:-4500}
d=$(dirname "$0")
cg=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope
bash "$d/bg.sh" "$label-sampler" $((max+300)) bash "$d/sample.sh" "$OUT/$label.tsv" $((max+200)) "$cg" "$dpid"
bash "$d/bg.sh" "$label-queue" $((max+300)) node "$d/queue-sample.mjs" .git/squeal/store.sqlite "$OUT/$label.queue.tsv" $((max+200))
sleep 15   # an idle baseline before the edit
date +%s%3N > "$OUT/$label.t0"
bash "$d/edit.sh" "$label" "$path"
sleep 40   # let the revision land before the idle check can see an empty queue
bash "$d/wait-idle.sh" "$max"
date +%s%3N > "$OUT/$label.t1"
pkill -f "sample.sh $OUT/$label.tsv"; pkill -f "queue-sample.mjs .git/squeal/store.sqlite $OUT/$label.queue.tsv"
echo "done $label"
