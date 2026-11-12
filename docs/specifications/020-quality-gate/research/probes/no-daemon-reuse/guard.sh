#!/bin/sh
# Throwaway (row 020-38): runs "$@" only while the one-minute load is below 24;
# waits up to 20 minutes for it, then skips (exit 99). Prints the load beside the run.
i=0
while :; do
  l=$(cut -d' ' -f1 /proc/loadavg)
  if awk "BEGIN{exit !($l < 24)}"; then echo "load-1m-at-start $l $(date -u +%FT%TZ)" >&2; exec "$@"; fi
  i=$((i+1)); [ $i -gt 80 ] && { echo "skipped: load $l not below 24 $(date -u +%FT%TZ)" >&2; exit 99; }
  sleep 15
done
