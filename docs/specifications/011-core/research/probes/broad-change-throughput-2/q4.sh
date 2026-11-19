#!/bin/bash
# q4.sh <label> <daemons> <user config json> <path>: question 4. Daemons of
# clone copies $P/q4-1 .. $P/q4-<daemons> (copies of the warmed clone, one
# store each) share this probe's private pool directory, so the user config
# (`capacity.hostSlots`, `capacity.backgroundShare`) rules them together.
# Starts each in its own scope sq-<label>-<i>, waits until each is idle,
# samples the host (load, busy cores, procs_running every 5 s), each scope's
# live Vitest workers every 1 s and each store's queue every 2 s, edits
# <path> in every copy within a second, and waits until all are idle. Each
# copy has one agent in turn (hold.sh), so its run-loop group waits (HELD=1).
d=$(cd "$(dirname "$0")" && pwd)
label=$1; n=$2; ucfg=$3; path=$4
. "$d/env.sh"
export HELD=1
mkdir -p "$XDG_CONFIG_HOME/squeal"; echo "$ucfg" > "$XDG_CONFIG_HOME/squeal/config.json"
cgs=(); pids=()
for i in $(seq 1 "$n"); do
  export SQ_REPO="$P/q4-$i"; cd "$SQ_REPO"
  sq stop >/dev/null 2>&1; sleep 2
  out=$(bash "$d/start-daemon.sh" "sq-$label-$i"); echo "$out" > "$OUT/$label.$i.daemon.txt"
  pids+=("$(echo "$out" | awk '/^pid=/ && / daemon /{sub("pid=","",$1); print $1; exit}')")
  # an agent mid-turn in every copy, as in arms H0 and T: run-loop held (first run, 2026-11-19)
  bash "$d/hold.sh" "$label-$i" > "$OUT/$label.$i.hold.store.txt" 2>&1
  cgs+=("/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/sq-$label-$i.scope")
done
for i in $(seq 1 "$n"); do (export SQ_REPO="$P/q4-$i"; bash "$d/wait-idle.sh" 1800); done
{ date -u +%FT%TZ; uptime; ps -eo pid,etime,pcpu,args --sort=-pcpu | head -8 | cut -c1-150; echo "$ucfg"; } > "$OUT/$label.load.txt"
bash "$d/bg.sh" "$label-sampler" 4000 bash "$d/sample.sh" "$OUT/$label.tsv" 3800 "${cgs[0]}" "${pids[0]}"
bash "$d/bg.sh" "$label-workers" 4000 node "$d/workers.mjs" "$OUT/$label.workers.tsv" 3800 "${cgs[@]}"
for i in $(seq 1 "$n"); do
  bash "$d/bg.sh" "$label-queue-$i" 4000 node "$d/queue-sample.mjs" "$P/q4-$i/.git/squeal/store.sqlite" "$OUT/$label.$i.queue.tsv" 3800
done
sleep 15
date +%s%3N > "$OUT/$label.t0"
for i in $(seq 1 "$n"); do
  echo "// probe 011-400 $label $(date +%s%N)" >> "$P/q4-$i/$path"
  printf "%s\t%s\n" "$(date +%s%3N)" "q4-$i/$path" >> "$OUT/$label.edits.tsv"
done
sleep 40
for i in $(seq 1 "$n"); do (export SQ_REPO="$P/q4-$i"; bash "$d/wait-idle.sh" 3600); done
date +%s%3N > "$OUT/$label.t1"
for x in sampler workers $(seq -f "queue-%g" 1 "$n"); do kill "$(cat "$OUT/$label-$x.pid")" 2>/dev/null; done
for i in $(seq 1 "$n"); do (export SQ_REPO="$P/q4-$i"; cd "$SQ_REPO"; sq stop >/dev/null 2>&1); done
SQ_N=$n node "$d/q4.mjs" "$label" > "$OUT/$label.q4.json"
echo "q4 $label done $(date -u +%FT%TZ)"
