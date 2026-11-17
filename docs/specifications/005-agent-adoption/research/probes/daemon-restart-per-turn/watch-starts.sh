#!/usr/bin/env bash
# Throwaway probe for row 005-99 (see README.md). Passive: reads /proc only, signals nothing.
# Every 2 s for $1 seconds, prints each live Squeal daemon's pid, age (s), CPU seconds
# (utime + stime, own process only), private MiB, the 1-minute load and its label.
# Usage: watch-starts.sh 900 > starts.tsv
end=$(( $(date +%s) + ${1:-600} ))
tick=$(getconf CLK_TCK)
while [ "$(date +%s)" -lt "$end" ]; do
  now=$(date -u +%FT%TZ)
  load=$(cut -d' ' -f1 /proc/loadavg)
  for p in /proc/[0-9]*; do
    c=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null) || continue
    case "$c" in
      "squeal "*" daemon @"*)
        pid=${p#/proc/}
        read -r -a s < "$p/stat" 2>/dev/null || continue
        cpu=$(( (s[13] + s[14]) / tick ))
        age=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
        priv=$(awk '/^Private_Clean:|^Private_Dirty:/{t+=$2} END{print int(t/1024)}' "$p/smaps_rollup" 2>/dev/null)
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$now" "$pid" "$age" "$cpu" "$priv" "$load" "$(echo "$c" | awk '{print $2, $4}')"
        ;;
    esac
  done
  sleep 2
done
