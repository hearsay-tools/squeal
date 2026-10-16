#!/bin/bash
# Throwaway: 4 writers + 1 integrity_check reader + 1 idle keeper on a
# disposable store, while `why` runs <n> times (with `burst`, <n> at once).
# Usage: churn.sh <repo> <n> <cli.mjs> [burst]
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$1; n=$2; cli=$3; burst=${4:-}
db=$repo/.git/squeal/store.sqlite
ms() { date +%s%3N; }
node "$here/keeper.mjs" "$db" 600000 >/dev/null & keeper=$!
sleep 0.5
pids=()
for w in 1 2 3 4; do node --disable-warning=ExperimentalWarning "$here/churn.mjs" "$db" writer 60000 4 & pids+=($!); done
node --disable-warning=ExperimentalWarning "$here/churn.mjs" "$db" reader 60000 & pids+=($!)
sleep 3
ok=0; fail=0; max=0
if [ -n "$burst" ]; then
  for i in $(seq 1 "$n"); do
    ( t0=$(ms); out=$(cd "$repo" && HOME=/tmp/i8/home node --disable-warning=ExperimentalWarning "$cli" why 'auth > login' 2>&1); code=$?; t1=$(ms)
      echo "burst why #$i exit=$code $((t1 - t0)) ms $(head -1 <<<"$out" | cut -c1-60)" ) &
  done
  wait $(jobs -p | grep -v -e "$keeper" $(printf -- '-e %s ' "${pids[@]}")) 2>/dev/null
  sleep 2
fi
for i in $(seq 1 "$([ -n "$burst" ] && echo 0 || echo "$n")"); do
  t0=$(ms); out=$(cd "$repo" && HOME=/tmp/i8/home node --disable-warning=ExperimentalWarning "$cli" why 'auth > login' 2>&1); code=$?; t1=$(ms)
  d=$((t1 - t0)); [ $d -gt $max ] && max=$d
  if [ $code = 0 ]; then ok=$((ok+1)); else fail=$((fail+1)); echo "why #$i exit=$code $d ms $(head -1 <<<"$out")"; fi
done
echo "why: $ok ok, $fail failed, slowest $max ms; wal $(stat -c %s "$db-wal") bytes"
wait "${pids[@]}"; kill $keeper
