#!/bin/bash
# arm.sh <label> <cli> <runner json> <user config json> <held 0|1> <path> [max s]
# One measured run of question 1: stops any daemon of the clone; sets the
# clone's squeal.config.json `runner` block (`-`: as committed, else the JSON
# merged into it) and the private user config (`{}`: none); starts a fresh
# daemon with <cli> (`orig`, or `big`: the copy with the patched backlog
# budget, README) in systemd scope sq-<label>; waits until idle; with held 1
# registers an agent in turn (hold.sh); records the VM's load; edits <path>
# once (run-edit.sh); waits until idle; writes the timeline, the refusals and
# the per-tier analysis; stops the daemon.
d=$(cd "$(dirname "$0")" && pwd)
label=$1; cli=$2; runner=$3; ucfg=$4; held=$5; path=$6; max=${7:-4500}
export SQ_CLI
[ "$cli" = big ] && SQ_CLI="${P:-$HOME/work/011-400}/squeal/plugins/claude-code/dist/cli/squeal-big.mjs"
. "$d/env.sh"
export HELD=$held
sq stop >/dev/null 2>&1; sleep 3
git checkout -q squeal.config.json
if [ "$runner" != "-" ]; then
  RUNNER="$runner" node -e 'const f="squeal.config.json",fs=require("fs");const c=JSON.parse(fs.readFileSync(f));Object.assign(c.runner,JSON.parse(process.env.RUNNER));fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
fi
mkdir -p "$XDG_CONFIG_HOME/squeal"; echo "$ucfg" > "$XDG_CONFIG_HOME/squeal/config.json"
{ echo "cli=$SQ_CLI"; sha256sum "$SQ_CLI"; echo "runner=$(node -p 'JSON.stringify(require("./squeal.config.json").runner)')"; echo "user=$ucfg held=$held path=$path"; } > "$OUT/$label.arm.txt"
out=$(bash "$d/start-daemon.sh" "sq-$label"); echo "$out" >> "$OUT/$label.arm.txt"
dpid=$(echo "$out" | awk '/^pid=/ && / daemon /{sub("pid=","",$1); print $1; exit}')
[ -z "$dpid" ] && { echo "no daemon pid"; cat "$OUT/$label.arm.txt"; exit 1; }
echo "$label daemon=$dpid"
bash "$d/wait-idle.sh" 1800
[ "$held" = 1 ] && { bash "$d/hold.sh" "$label" > "$OUT/$label.hold.store.txt" 2>&1; sleep 5; }
sq status > "$OUT/$label.status-before.txt" 2>&1
{ date -u +%FT%TZ; uptime; ps -eo pid,etime,pcpu,args --sort=-pcpu | head -8 | cut -c1-150; } > "$OUT/$label.load.txt"
bash "$d/run-edit.sh" "$label" "$dpid" "sq-$label" "$path" "$max"
sq status > "$OUT/$label.status-after.txt" 2>&1
node "$d/timeline.mjs" "$label" > "$OUT/$label.timeline.json"
node "$d/refusals.mjs" "$label" > "$OUT/$label.refusals.json"
node "$d/tiers.mjs" "$label" > "$OUT/$label.tiers.json"
{ date -u +%FT%TZ; uptime; } >> "$OUT/$label.load.txt"
sq stop >/dev/null 2>&1; sleep 3
git checkout -q squeal.config.json
echo "arm $label done $(date -u +%FT%TZ)"
