#!/bin/bash
# warm.sh: the warm-up, as 011-400's, with the base bundle. A fresh daemon
# (scope sq-warm), `squeal run --fast` (every fast-lane test file once, which
# stores closures and durations), wait until idle, stop. Then two copies of
# the warmed clone ($P/q4-1, q4-2, store included) for the two-daemon arms.
d=$(cd "$(dirname "$0")" && pwd)
export ARM=base
. "$d/env.sh"
mkdir -p "$XDG_CONFIG_HOME/squeal"; echo '{}' > "$XDG_CONFIG_HOME/squeal/config.json"
out=$(bash "$d/start-daemon.sh" sq-warm); echo "$out" > "$OUT/warm.daemon.txt"
bash "$d/wait-idle.sh" 1800
date +%s%3N > "$OUT/warm.t0"
sq run --fast --wait 3600000 > "$OUT/warm.run.txt" 2>&1; echo "warm run rc=$?"
bash "$d/wait-idle.sh" 3600
date +%s%3N > "$OUT/warm.t1"
sq stop >/dev/null 2>&1; sleep 5
for i in 1 2; do rm -rf "$P/q4-$i"; cp -a "$SQ_REPO" "$P/q4-$i"; done
du -sh "$P"/q4-1 "$SQ_REPO"; df -h "$P" | tail -1
echo "warm done $(date -u +%FT%TZ)"
