#!/bin/sh
# Throwaway (row 020-41): the probe queue, each step guarded by load (steps.sh, guard.sh).
HERE=$(cd "$(dirname "$0")" && pwd)
for step in hooks control starve long; do
  echo "$(date -u +%FT%TZ) $step start"
  "$HERE/steps.sh" $step || echo "$(date -u +%FT%TZ) $step failed or skipped: $?"
  echo "$(date -u +%FT%TZ) $step end"
done
