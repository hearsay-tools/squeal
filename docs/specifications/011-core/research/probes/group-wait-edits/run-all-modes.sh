#!/bin/sh
# Throwaway: the probe's three batches, one after another, with uptime before each.
set -u
cd "$(dirname "$0")"
for mode in cli inproc latency; do
  echo "== $mode $(date -u +%FT%TZ) $(uptime)" >> evidence/uptime.txt
  PROBE_RUNS=${PROBE_RUNS:-24} PROBE_MODE=$mode ../../../../../../node_modules/.bin/vitest run --config vitest.config.ts > evidence/vitest-$mode.log 2>&1
  echo "== $mode done $(date -u +%FT%TZ) exit $?" >> evidence/uptime.txt
done
