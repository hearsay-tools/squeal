#!/bin/sh
# Throwaway (026 agent37-sandboxes). From this host: 3 new ssh connections (no master), then
# a detached ControlMaster and 5 commands over it; prints ms each. A37_HOME holds the key.
ID=$1; D=$(cd "$(dirname "$0")" && pwd)
ARGS=$("$D/sshcmd.sh" "$ID" | tr '\n' ' ')
NOCM=$(echo "$ARGS" | sed "s|-o ControlMaster=auto|-o ControlMaster=no -o ControlPath=none|")
n=""; for i in 1 2 3; do s=$(date +%s%N); ssh $NOCM true < /dev/null; n="$n $(( ($(date +%s%N) - s) / 1000000 ))"; done
s=$(date +%s%N); ssh $ARGS -M -f -N > /dev/null 2>&1 < /dev/null; m=$(( ($(date +%s%N) - s) / 1000000 ))
c=""; for i in 1 2 3 4 5; do s=$(date +%s%N); ssh $ARGS true < /dev/null; c="$c $(( ($(date +%s%N) - s) / 1000000 ))"; done
echo "$ID new ssh ms:$n; master up $m ms; over master ms:$c; this host load $(cut -d' ' -f1 /proc/loadavg)"
