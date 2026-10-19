#!/usr/bin/env bash
# THROWAWAY probe (011-core/research/streaming-lanes.md). The second prototype build's arms, after
# run-arms.sh: W1's tiers on the heavy fixture with an edit 100 s in, the edit's cancel honoured
# by draining (`drain`: start no further file) or by killing (`kill`), or the edit's tier started
# beside the backlog tier (`beside`). Same hold below a load of 8.
# Usage: run-variants.sh <cli.mjs of the second build> <probe dir> [variants...]
set -euo pipefail
cli=$1; probe=$2; shift 2
hold() { until awk "BEGIN{exit !($(cut -d' ' -f1 /proc/loadavg) < 8)}"; do sleep 10; done; }
for v in "${@:-drain kill beside}"; do
  for v1 in $v; do
    name="heavy-w1-$v1"
    hold
    rm -rf "/tmp/r2sl/fx-$name" "/tmp/r2sl/s-$name"
    node "$probe/make-fixture.mjs" "/tmp/r2sl/fx-$name" heavy
    echo "$(date +%T) $name start load $(cut -d' ' -f1 /proc/loadavg)"
    case $v1 in
      drain|kill) SQUEAL_PROTO_CANCEL=$v1 node "$probe/drive.mjs" "$cli" "/tmp/r2sl/fx-$name" "/tmp/r2sl/s-$name" w1 100 "$probe/results/$name.json" ;;
      beside) SQUEAL_PROTO_BESIDE=1 node "$probe/drive.mjs" "$cli" "/tmp/r2sl/fx-$name" "/tmp/r2sl/s-$name" w1 100 "$probe/results/$name.json" ;;
    esac
  done
done
echo "$(date +%T) variants done"
