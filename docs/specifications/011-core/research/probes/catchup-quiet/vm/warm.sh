#!/bin/bash
# warm.sh: the warm-up, as 011-395's step 2. A fresh daemon (scope sq-warm),
# `squeal run --fast` (every fast-lane test file once, which stores closures
# and durations), wait until idle, stop. 011-416: no copies.
d=$(cd "$(dirname "$0")" && pwd)
. "$d/env.sh"
echo '{}' > "$XDG_CONFIG_HOME/squeal/config.json" 2>/dev/null || { mkdir -p "$XDG_CONFIG_HOME/squeal"; echo '{}' > "$XDG_CONFIG_HOME/squeal/config.json"; }
out=$(bash "$d/start-daemon.sh" sq-warm); echo "$out" > "$OUT/warm.daemon.txt"
bash "$d/wait-idle.sh" 1800
date +%s%3N > "$OUT/warm.t0"
sq run --fast --wait 3600000 > "$OUT/warm.run.txt" 2>&1; echo "warm run rc=$?"
bash "$d/wait-idle.sh" 3600
date +%s%3N > "$OUT/warm.t1"
sq stop >/dev/null 2>&1; sleep 5
du -sh "$SQ_REPO"; df -h "$P" | tail -1
echo "warm done $(date -u +%FT%TZ)"
