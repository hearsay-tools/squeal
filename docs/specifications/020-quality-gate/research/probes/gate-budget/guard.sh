#!/bin/sh
# Throwaway (row 020-41): runs "$@" only while the one-minute load is at most 24;
# checks every 30 s for up to 4 hours, then exits 99 (skipped). Prints the load at start.
i=0
while :; do
  l=$(cut -d' ' -f1 /proc/loadavg)
  if awk "BEGIN{exit !($l <= 24)}"; then echo "load-1m-at-start $l $(date -u +%FT%TZ)" >&2; exec "$@"; fi
  i=$((i+1)); [ $i -gt 480 ] && { echo "skipped: load $l above 24 $(date -u +%FT%TZ)" >&2; exit 99; }
  sleep 30
done
