#!/bin/sh
# 015-14 part B, D10: A/B pairs, coverage off and on, interleaved, the order
# alternating per pair. A pair starts only while the one-minute load is at or
# under 24 on 24 CPUs (gate.sh); each hold is logged.
# Usage: pairs.sh <first pair> <last pair> <out.jsonl> <log> <deadline, epoch seconds>
B=/tmp/dogfood-015-14/w-327524f0
first=$1; last=$2; out=$3; log=$4; deadline=$5
i=$first
while [ "$i" -le "$last" ]; do
  sh "$B/bin/gate.sh" "pair $i" "$log" "$deadline" || exit 2
  if [ $((i % 2)) = 1 ]; then order="off on"; else order="on off"; fi
  for m in $order; do
    python3 -I "$B/bin/ab.py" "$m" "p$i" "$out" >> "$log" 2>&1
  done
  i=$((i + 1))
done
echo "$(date -u +%FT%TZ) done" >> "$log"
