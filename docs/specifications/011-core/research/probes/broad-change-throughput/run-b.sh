#!/bin/bash
# run-b.sh <daemon pid> <scope unit> <t2 s> <t3 s> [max s]: experiment B.
#   edit 1 at 0 s: packages/contract/src/ci-wait.ts (about 1,200 files queue)
#   at <t2> s: edit 2, one queued test file X at the tail of the queue, and a
#     named wait `squeal status --wait 1800000 Y` on another tail file Y
#   at <t3> s: edit 3, ci-wait.ts again (re-keys every file edit 1 queued)
# then waits until idle or [max s]. Samplers as run-edit.sh, plus pool permits.
. "$(dirname "$0")/env.sh"
dpid=$1; unit=$2; t2=$3; t3=$4; max=${5:-4500}; d=$(dirname "$0"); label=B
cg=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope
bash "$d/bg.sh" "$label-sampler" $((max+300)) bash "$d/sample.sh" "$OUT/$label.tsv" $((max+200)) "$cg" "$dpid"
bash "$d/bg.sh" "$label-queue" $((max+300)) node "$d/queue-sample.mjs" .git/squeal/store.sqlite "$OUT/$label.queue.tsv" $((max+200))
bash "$d/bg.sh" "$label-permits" $((max+300)) bash -c "end=\$((\$(date +%s)+$max+200)); while [ \$(date +%s) -lt \$end ]; do echo \"\$(date +%s%3N) \$(lslocks -n -o PATH 2>/dev/null | grep -c '$P/xdg/squeal/pool')\"; sleep 2; done > $OUT/$label.permits.txt"
sleep 15
date +%s%3N > "$OUT/$label.t0"
bash "$d/edit.sh" "$label" packages/contract/src/ci-wait.ts
sleep "$t2"
node "$d/pick-queued.mjs" .git/squeal/store.sqlite 2 > "$OUT/$label.picked.txt"
X=$(sed -n 1p "$OUT/$label.picked.txt"); Y=$(sed -n 2p "$OUT/$label.picked.txt")
bash "$d/edit.sh" "$label" "$X"
( s=$(date +%s%3N); timeout 1900 node --disable-warning=ExperimentalWarning "$SQ_CLI" status --wait 1800000 "$Y" > "$OUT/$label.named.txt" 2>&1; rc=$?
  echo "named_start=$s named_end=$(date +%s%3N) rc=$rc" >> "$OUT/$label.named.txt" ) &
sleep $((t3 - t2))
bash "$d/edit.sh" "$label" packages/contract/src/ci-wait.ts
sleep 40
bash "$d/wait-idle.sh" "$max"
wait
date +%s%3N > "$OUT/$label.t1"
echo "done $label"
