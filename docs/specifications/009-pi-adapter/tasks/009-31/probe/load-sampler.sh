#!/usr/bin/env bash
# Row 009-31: one line per second until killed: time, 1-minute load, CPU PSI avg10,
# and full=1 while a process holds the full-run lock (a vitest under flock).
# Usage: OUT=<file> load-sampler.sh
set -u
while :; do
  full=0
  pgrep -f "flock /run/user/$(id -u)/squeal-full-run.lock" >/dev/null && full=1
  printf '%s %s %s full=%s\n' "$(date -u +%H:%M:%S)" "$(cut -d' ' -f1 /proc/loadavg)" \
    "$(sed -n 's/^some avg10=\([0-9.]*\).*/\1/p' /proc/pressure/cpu)" "$full" >>"$OUT"
  sleep 1
done
