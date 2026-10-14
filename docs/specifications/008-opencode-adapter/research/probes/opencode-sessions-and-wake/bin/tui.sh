#!/bin/sh
# Throwaway. The interactive TUI in a private tmux server (socket oc008s) as squeal-e2e: one prompt,
# then the plugin wakes the idle session 3 s after its first idle. Captures the pane, then kills
# only this tmux server.
set -u
. "$(dirname "$0")/env.sh"
label=${1:-t1}
idles() { grep "\"label\":\"$label\"" $PROBE_LOG | grep -c '"type":"session.idle"'; }
wait_n() { n=0; while [ "$($1)" -lt "$2" ] && [ $n -lt 240 ]; do sleep 0.5; n=$((n+1)); done; }
inits() { grep "\"label\":\"$label\"" $PROBE_LOG | grep -c '"kind":"init"'; }
tmux -L oc008s kill-server 2>/dev/null
tmux -L oc008s new-session -d -x 160 -y 45 "cd $W/repo && PROBE_LABEL=$label PROBE_WAKE=delay:3000 PROBE_LOG=$PROBE_LOG opencode -m $MODEL; sleep 30"
wait_n inits 1
sleep 3
tmux -L oc008s send-keys "Reply with exactly TUI-FIRST and nothing else."
sleep 1
tmux -L oc008s send-keys Enter
wait_n idles 2
sleep 3
tmux -L oc008s capture-pane -p > $W/log/$label.pane.txt
ps -u squeal-e2e -o pid,ppid,pgid,args | grep -E "opencode|bun" | grep -v grep | grep -v "4198" | cut -c1-160 > $W/log/$label.ps.txt
tmux -L oc008s kill-server
echo "idles=$(idles)"
