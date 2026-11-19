#!/bin/bash
# arm.sh <label> <share> <path> [max s]: one run of one arm. Stops any daemon
# of the clone, writes the private user config with capacity.backgroundShare
# <share>, starts a fresh daemon in its own systemd user scope sq-<label>,
# waits until idle, records the VM's load and top processes, edits <path>
# once (run-edit.sh), waits until idle again, writes the timeline and the
# ceiling refusals, and stops the daemon.
. "$(dirname "$0")/env.sh"
label=$1; share=$2; path=$3; max=${4:-4500}; d=$(dirname "$0")
sq stop >/dev/null 2>&1; sleep 3
mkdir -p "$XDG_CONFIG_HOME/squeal"
printf '{"capacity":{"backgroundShare":%s}}\n' "$share" > "$XDG_CONFIG_HOME/squeal/config.json"
out=$(bash "$d/start-daemon.sh" "sq-$label")
echo "$out" > "$OUT/$label.daemon.txt"
dpid=$(echo "$out" | awk '/^pid=/ && / daemon /{sub("pid=","",$1); print $1; exit}')
[ -z "$dpid" ] && { echo "no daemon pid"; cat "$OUT/$label.daemon.txt"; exit 1; }
echo "$label share=$share daemon=$dpid"
bash "$d/wait-idle.sh" 1800
{ date -u +%FT%TZ; uptime; ps -eo pid,etime,pcpu,args --sort=-pcpu | head -8 | cut -c1-150; } > "$OUT/$label.load.txt"
sq ps > "$OUT/$label.ps.txt" 2>&1
bash "$d/run-edit.sh" "$label" "$dpid" "sq-$label" "$path" "$max"
node "$d/timeline.mjs" "$label" > "$OUT/$label.timeline.json"
node "$d/refusals.mjs" "$label" > "$OUT/$label.refusals.json"
{ date -u +%FT%TZ; uptime; } >> "$OUT/$label.load.txt"
sq stop >/dev/null 2>&1; sleep 3
echo "arm $label done"
