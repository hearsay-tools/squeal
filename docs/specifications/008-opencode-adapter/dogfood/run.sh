#!/bin/sh
# One `opencode run` in the remeda clone, as squeal-e2e through as-user.sh, with its JSON events
# and wall time (with the load before and after) in logs/<name>.run.*. Extra args go to opencode
# run (--continue, -m ...). Usage: sh run.sh <name> <model> <prompt> [args...]
set -u
D=/home/squeal-e2e/dogfood-008
name=$1 model=$2 prompt=$3
shift 3
{
  printf 'start %s load %s\n' "$(date +%T.%3N)" "$(cut -d' ' -f1 /proc/loadavg)"
  s=$(date +%s%3N)
  sudo -n -u squeal-e2e -H sh "$D/scripts/as-user.sh" -C "$D/remeda" opencode run --format json -m "$model" "$@" "$prompt" </dev/null >"/tmp/run-$name.out" 2>"/tmp/run-$name.err"
  code=$?
  printf 'exit %s after %s ms, at %s load %s\n' "$code" "$(( $(date +%s%3N) - s ))" "$(date +%T.%3N)" "$(cut -d' ' -f1 /proc/loadavg)"
} | sudo -n -u squeal-e2e tee -a "$D/logs/$name.run.txt"
sudo -n -u squeal-e2e tee -a "$D/logs/$name.run.jsonl" <"/tmp/run-$name.out" >/dev/null
sudo -n -u squeal-e2e tee -a "$D/logs/$name.run.err" <"/tmp/run-$name.err" >/dev/null
rm -f "/tmp/run-$name.out" "/tmp/run-$name.err"
