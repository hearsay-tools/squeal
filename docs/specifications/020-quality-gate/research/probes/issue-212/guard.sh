#!/bin/sh
# Throwaway (row 020-56): runs "$@" only while the one-minute load is below the CPU count
# (the human's rule); checks every 30 s for up to 6 hours, then exits 99 (skipped).
# Prints the load at start to stderr.
cpus=$(getconf _NPROCESSORS_ONLN)
i=0
while :; do
  l=$(cut -d' ' -f1 /proc/loadavg)
  if awk "BEGIN{exit !($l < $cpus)}"; then echo "load-1m-at-start $l cpus $cpus $(date -u +%FT%TZ)" >&2; exec "$@"; fi
  i=$((i+1)); [ $i -gt 720 ] && { echo "skipped: load $l not below $cpus $(date -u +%FT%TZ)" >&2; exit 99; }
  sleep 30
done
