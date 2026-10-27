#!/bin/sh
# 015-14 Round 3, D10: A/B pairs, coverage off and on, interleaved, the order
# alternating per pair (odd: off then on). Round 2's pairs.sh, with the gate
# before each arm, not only each pair: an arm starts only while the one-minute
# load is at or under the CPU count (gate.sh). A file `out/stop-ab` stops the
# next arm.
# Usage: pairs.sh <first pair> <last pair> <out.jsonl> <log> <deadline, epoch seconds>
B=${DOGFOOD_BASE:-/var/tmp/dogfood-015-14/w-d3937b73}
first=$1; last=$2; out=$3; log=$4; deadline=$5
i=$first
while [ "$i" -le "$last" ]; do
  if [ $((i % 2)) = 1 ]; then order="off on"; else order="on off"; fi
  for m in $order; do
    sh "$B/bin/gate.sh" "pair $i $m" "$log" "$deadline" || exit 2
    python3 -I "$B/bin/ab.py" "$m" "p$i" "$out" >> "$log" 2>&1
  done
  i=$((i + 1))
done
echo "$(date -u +%FT%TZ) done" >> "$log"
