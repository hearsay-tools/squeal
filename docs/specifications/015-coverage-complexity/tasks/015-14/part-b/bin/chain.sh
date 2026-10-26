#!/bin/sh
# 015-14 part B: after pair 1, the gated steps in order: a one-file smoke run
# of open question 5, its 40-file runs, pair 2, then pair 3 if it can start
# by the earlier deadline. Usage: chain.sh <pid of pair 1's pairs.sh>
B=/tmp/dogfood-015-14/w-327524f0
log=$B/out/ab.log
while kill -0 "$1" 2>/dev/null; do sleep 10; done
end=$(date -d 2026-10-26T19:00:00Z +%s)
end3=$(date -d 2026-10-26T18:15:00Z +%s)
sh "$B/bin/oq5.sh" "$B/out/oq5-smoke.txt" "$log" "$end" oq5smoke
if grep -q '"records":{"test/' "$B/out/oq5smoke-a.json" 2>/dev/null; then
  sh "$B/bin/oq5.sh" "$B/out/oq5-list.txt" "$log" "$end" oq5
else
  echo "$(date -u +%FT%TZ) oq5 skipped: the smoke run stored no record" >> "$log"
fi
sh "$B/bin/pairs.sh" 2 2 "$B/out/ab.jsonl" "$log" "$end"
sh "$B/bin/pairs.sh" 3 3 "$B/out/ab.jsonl" "$log" "$end3"
echo "$(date -u +%FT%TZ) chain done" >> "$log"
