#!/bin/bash
# marks.sh <out> <seconds>: every 1 s, each pool mark in this probe's private
# pool directory ($P/xdg/squeal), one line each: epoch ms, the mark's
# file name and its JSON (want, grant, since, cores, background). Row 011-423:
# shows whether a daemon in its catch-up quiet states its demand (arms q, qc).
. "$(dirname "$0")/env.sh"
out=$1; end=$(( $(date +%s) + $2 )); dir="$P/xdg/squeal"
while [ "$(date +%s)" -lt "$end" ]; do
  t=$(date +%s%3N)
  for m in "$dir"/pool.mark.*; do
    case "$m" in *.tmp|*'*'*) continue;; esac
    printf "%s\t%s\t%s\n" "$t" "${m##*/}" "$(tr -d '\n' < "$m" 2>/dev/null)"
  done >> "$out"
  sleep 1
done
