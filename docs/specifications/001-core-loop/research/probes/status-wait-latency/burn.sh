#!/bin/sh
# Bounded extra load for one measured run: N (at most 8) single-thread busy loops, each under `timeout`.
# Usage: burn.sh <n> <seconds> <command...>; kills the burners by pid when the command ends, then checks none remain.
n=$1; secs=$2; shift 2
[ "$n" -le 8 ] || { echo "at most 8 burners" >&2; exit 2; }
pids=""; i=0
while [ $i -lt "$n" ]; do timeout "$secs" sh -c 'while :; do :; done' & pids="$pids $!"; i=$((i+1)); done
"$@"; status=$?
kill $pids 2>/dev/null; wait $pids 2>/dev/null
left=0; for p in $pids; do kill -0 "$p" 2>/dev/null && left=$((left+1)); done
echo "burners left: $left" >&2
ps -eo args | grep -c '^sh -c while :; do :; done' >&2
exit $status
