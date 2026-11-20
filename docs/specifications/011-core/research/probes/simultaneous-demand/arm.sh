#!/bin/bash
# arm.sh <label> <arm> <path> [max s]: one single-daemon run (011-400's arm
# H0 shape) with the Squeal bundle of <arm>. Stops any daemon of the clone,
# reverts earlier probe edits (results are stored by content key, so a fresh
# daemon starts with nothing queued), uses the default user config ({}:
# hostSlots 11 and the 9-CPU ceiling on 12 CPUs), starts a fresh daemon in
# scope sq-<label>, waits until idle, registers an agent in turn (hold.sh:
# squawk's run-loop group waits), records the VM's load, edits <path> once
# (run-edit.sh), waits until idle, writes the timeline and the per-tier
# analysis, stops the daemon. 011-400's arm.sh without the runner and CLI
# arguments.
d=$(cd "$(dirname "$0")" && pwd)
label=$1; export ARM=$2; path=$3; max=${4:-4500}
. "$d/env.sh"
export HELD=1
sq stop >/dev/null 2>&1; sleep 3
git checkout -q -- packages squeal.config.json
mkdir -p "$XDG_CONFIG_HOME/squeal"; echo '{}' > "$XDG_CONFIG_HOME/squeal/config.json"
{ echo "arm=$ARM cli=$SQ_CLI"; sha256sum "$SQ_CLI"; echo "path=$path"; } > "$OUT/$label.arm.txt"
out=$(bash "$d/start-daemon.sh" "sq-$label"); echo "$out" >> "$OUT/$label.arm.txt"
dpid=$(echo "$out" | awk '/^pid=/ && / daemon /{sub("pid=","",$1); print $1; exit}')
[ -z "$dpid" ] && { echo "no daemon pid"; cat "$OUT/$label.arm.txt"; exit 1; }
echo "$label daemon=$dpid"
bash "$d/wait-idle.sh" 1800
bash "$d/hold.sh" "$label" > "$OUT/$label.hold.store.txt" 2>&1; sleep 5
sq status > "$OUT/$label.status-before.txt" 2>&1
{ date -u +%FT%TZ; uptime; ps -eo pid,etime,pcpu,args --sort=-pcpu | head -8 | cut -c1-150; } > "$OUT/$label.load.txt"
bash "$d/run-edit.sh" "$label" "$dpid" "sq-$label" "$path" "$max"
sq status > "$OUT/$label.status-after.txt" 2>&1
node "$d/timeline.mjs" "$label" > "$OUT/$label.timeline.json"
node "$d/refusals.mjs" "$label" > "$OUT/$label.refusals.json"
node "$d/tiers.mjs" "$label" > "$OUT/$label.tiers.json"
{ date -u +%FT%TZ; uptime; } >> "$OUT/$label.load.txt"
sq stop >/dev/null 2>&1; sleep 3
git checkout -q -- packages squeal.config.json
echo "arm $label done $(date -u +%FT%TZ)"
