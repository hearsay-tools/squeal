#!/usr/bin/env bash
# THROWAWAY probe (011-core/research/streaming-lanes.md). Runs the node:test arms one after
# another, each on a fresh fixture and a fresh scratch dir under /tmp/r2sl, each started only
# while the one-minute load is below 8 (the brief's hold). Usage: run-arms.sh <cli.mjs> <probe dir>
set -euo pipefail
cli=$1; probe=$2
hold() { until awk "BEGIN{exit !($(cut -d' ' -f1 /proc/loadavg) < 8)}"; do sleep 10; done; }
arm() { # name shape editAt proto
  local name=$1 shape=$2 at=$3 proto=$4
  hold
  rm -rf "/tmp/r2sl/fx-$name" "/tmp/r2sl/s-$name"
  node "$probe/make-fixture.mjs" "/tmp/r2sl/fx-$name" "$shape" 300
  echo "$(date +%T) $name start load $(cut -d' ' -f1 /proc/loadavg)"
  node "$probe/drive.mjs" "$cli" "/tmp/r2sl/fx-$name" "/tmp/r2sl/s-$name" "$proto" "$at" "$probe/results/$name.json"
}
for proto in ${ARMS:-today w1 stream stream-over}; do arm "heavy-$proto" heavy 100 "$proto"; done
for proto in ${LIGHT:-today stream}; do arm "light-$proto" light -1 "$proto"; done
echo "$(date +%T) all done"
