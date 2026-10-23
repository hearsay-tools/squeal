#!/bin/sh
# 011-157 probe (throwaway), question 2: CPU seconds and RSS of the host's main-checkout daemons over time, from ps only (no socket, no store).
# Usage: sh sample-main.sh <out.tsv> <samples> <interval s>   Columns: time, load1, root, pid, elapsed s, cpu s (utime+stime), rss MiB, child processes.
out=$1; n=$2; iv=$3
for i in $(seq 1 "$n"); do
  t=$(date -u +%H:%M:%S); l=$(cut -d' ' -f1 /proc/loadavg)
  ps -eo pid=,args= | grep -E "squeal(\.mjs)? daemon /home/agent/projects/(squeal|cezar|toolkit-dev)( |$)" | grep -v grep | while read -r pid rest; do
    root=$(printf '%s\n' "$rest" | grep -oE '/home/agent/projects/(squeal|cezar|toolkit-dev)( |$)' | tr -d ' ')
    set -- $(cut -d' ' -f14,15,22 /proc/$pid/stat 2>/dev/null); [ -z "$1" ] && continue
    hz=$(getconf CLK_TCK); boot=$(awk '/btime/{print $2}' /proc/stat); now=$(date +%s)
    el=$((now - boot - $3 / hz)); cpu=$(( ($1 + $2) / hz )); rss=$(awk '/VmRSS/{print int($2/1024)}' /proc/$pid/status)
    kids=$(pgrep -P "$pid" | wc -l)
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$t" "$l" "${root##*/}" "$pid" "$el" "$cpu" "$rss" "$kids" >> "$out"
  done
  sleep "$iv"
done
