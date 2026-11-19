#!/bin/bash
# sequence.sh <path> <labels:shares...>: the experiment, in one detached
# process: the warm-up (squeal run --fast on a fresh daemon at the default
# share), then each arm in the given order, e.g. A1:0.75 F1:1 A2:0.75 F2:1.
. "$(dirname "$0")/env.sh"
d=$(dirname "$0"); path=$1; shift
mkdir -p "$XDG_CONFIG_HOME/squeal"
printf '{"capacity":{"backgroundShare":0.75}}\n' > "$XDG_CONFIG_HOME/squeal/config.json"
if [ ! -f "$OUT/warm.done" ]; then
  out=$(bash "$d/start-daemon.sh" sq-warm); echo "$out" > "$OUT/warm.daemon.txt"
  bash "$d/wait-idle.sh" 1800   # a fresh daemon takes a run request only once its start-up work is done
  date +%s%3N > "$OUT/warm.t0"
  sq run --fast --wait 3600000 > "$OUT/warm.run.txt" 2>&1
  echo "warm run rc=$?"
  bash "$d/wait-idle.sh" 3600
  date +%s%3N > "$OUT/warm.t1"; touch "$OUT/warm.done"
  sq stop >/dev/null 2>&1; sleep 3
fi
for arm in "$@"; do
  bash "$d/arm.sh" "${arm%%:*}" "${arm##*:}" "$path" 3600
done
echo "sequence done $(date -u +%FT%TZ)"
