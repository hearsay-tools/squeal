#!/usr/bin/env bash
# Throwaway: start a gate run in the squawk checkout, SIGKILL the gate once Vitest workers run, list what is left.
wt=$1; out=$2; sig=$3
SQ=~/.claude/plugins/cache/hearsay/squeal/0.1.523/dist/cli/squeal.mjs
cd "$wt"
echo "load=$(cut -d' ' -f1 /proc/loadavg) signal=$sig"
HOME=$out/home node $SQ code --base HEAD $FILES --timeout 300 --json > "$out/gate-kill.json" 2> "$out/gate-kill.err" &
gp=$!
kids() { ps -eo pid,ppid,etimes,pcpu,args | awk -v d="$wt" 'index($5,"node") && index($0,d)' | cut -c1-170; }
for i in $(seq 1 60); do sleep 0.5; n=$(kids | wc -l); [ "$n" -ge 2 ] && break; done
sleep 2
echo "gate=$gp children_after_s=$((i/2)) before:"; kids
kill -$sig $gp; wait $gp 2>/dev/null; echo "gate_exit=$?"
sleep 5; echo "5 s after:"; kids
sleep 25; echo "30 s after:"; kids
