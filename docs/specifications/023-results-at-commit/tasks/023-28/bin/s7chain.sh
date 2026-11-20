#!/bin/sh
# 023-28: after s7-01's batch ends, store copies for s7-02..05, their sessions, then s7-01 removed.
W=$(cd "$(dirname "$0")/.." && pwd)
while pgrep -f "batch.mjs --parallel 1 --keep s7-01" >/dev/null; do sleep 15; done
for n in 02 03 04 05; do
  sh "$W/bin/setup.sh" prepare-copy s7-$n s7-01 > "$W/logs/s7-$n.prepare.txt" 2>&1 || echo "s7-$n prepare-copy exit $?" >> "$W/logs/batch.log"
done
node "$W/bin/batch.mjs" --parallel 3 --prepared s7-02 s7-03 s7-04 s7-05
sh "$W/bin/setup.sh" remove s7-01
echo "$(date -u +%FT%TZ) s7 chain done" >> "$W/logs/batch.log"
