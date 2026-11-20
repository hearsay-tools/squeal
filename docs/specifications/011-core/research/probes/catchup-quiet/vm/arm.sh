#!/bin/bash
# arm.sh <label> <cli> <runner json> <user config json> <held 0|1> <path> [max s]
# 011-416: 011-400's arm.sh. <cli> is q120 (the release), q60 or q30 (the
# copies setup.sh patched); FOLLOW="<s> <path>" adds a second edit <s> s after
# the first (run-edit.sh). Before each arm the clone's earlier probe edits are
# reverted (git checkout -- packages), so the daemon starts with nothing queued.
# One measured run: stops any daemon of the clone; sets the
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
C="${P:-$HOME/work/8fdf8a51}/squeal/plugins/claude-code/dist/cli"  # bg.sh has moved HOME already
case "$cli" in q120) SQ_CLI="$C/squeal.mjs" ;; q60|q30) SQ_CLI="$C/squeal-$cli.mjs" ;; *) echo "cli?"; exit 1 ;; esac
. "$d/env.sh"
export HELD=$held
sq stop >/dev/null 2>&1; sleep 3
git checkout -q -- packages
git checkout -q squeal.config.json
if [ "$runner" != "-" ]; then
  RUNNER="$runner" node -e 'const f="squeal.config.json",fs=require("fs");const c=JSON.parse(fs.readFileSync(f));Object.assign(c.runner,JSON.parse(process.env.RUNNER));fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
fi
mkdir -p "$XDG_CONFIG_HOME/squeal"; echo "$ucfg" > "$XDG_CONFIG_HOME/squeal/config.json"
{ echo "cli=$SQ_CLI"; sha256sum "$SQ_CLI"; echo "runner=$(node -p 'JSON.stringify(require("./squeal.config.json").runner)')"; echo "user=$ucfg held=$held path=$path follow=${FOLLOW:-none}"; } > "$OUT/$label.arm.txt"
out=$(bash "$d/start-daemon.sh" "sq-$label"); echo "$out" >> "$OUT/$label.arm.txt"
dpid=$(echo "$out" | awk '/^pid=/ && / daemon /{sub("pid=","",$1); print $1; exit}')
[ -z "$dpid" ] && { echo "no daemon pid"; cat "$OUT/$label.arm.txt"; exit 1; }
echo "$label daemon=$dpid"
bash "$d/wait-idle.sh" 1800
[ "$held" = 1 ] && { bash "$d/hold.sh" "$label" > "$OUT/$label.hold.store.txt" 2>&1; sleep 5; }
sq status > "$OUT/$label.status-before.txt" 2>&1
# 011-416: the edit waits up to 240 s for a one-minute load under 1 (the
# previous arm's tail decays), and stops when another task's directory under
# ~/work or a process outside this probe uses the VM.
for i in $(seq 24); do awk '{exit !($1 < 1)}' /proc/loadavg && break; sleep 10; done
others=$(ls ~/work 2>/dev/null | grep -v '^8fdf8a51$'; ps -eo pcpu=,args= | awk '$1 > 20' | grep -v -e 8fdf8a51 -e ' ps ' | head -3)
[ -n "$others" ] && { echo "another task on the VM: $others" | tee "$OUT/$label.busy.txt"; sq stop >/dev/null 2>&1; exit 3; }
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
