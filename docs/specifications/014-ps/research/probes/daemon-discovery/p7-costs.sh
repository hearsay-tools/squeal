#!/usr/bin/env bash
# Throwaway probe P7 (014-01): wall time of each discovery read on the live
# host, five runs each, read-only. Prints the one-minute load beside each.
PROBES=$(cd "$(dirname "$0")" && pwd)
t() { local s e; s=$(date +%s%N); "$@" >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e - s) / 1000000 )); }
row() { local name=$1; shift; local v=(); for _ in 1 2 3 4 5; do v+=("$(t "$@")"); done; echo "$name: ${v[*]} ms (load $(cut -d' ' -f1 /proc/loadavg))"; }
row "node -e 0 (startup floor)" node -e 0
row "ss -xlpe (vfs inode + pid, scans every /proc/*/fd)" ss -xlpe
row "ss -xle (vfs inode, no pid)" ss -xle
row "cat /proc/net/unix" cat /proc/net/unix
row "cat /proc/locks" cat /proc/locks
row "pgrep -af 'squeal.* daemon '" pgrep -af 'squeal.* daemon '
row "ps -eo pid,lstart,args" ps -eo pid,lstart,args
row "P2 whole (node, dirs + ss -p + /proc scan)" node "$PROBES/p2-live-discovery.mjs"
