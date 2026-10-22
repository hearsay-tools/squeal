#!/bin/bash
# measure-hold.sh <repo> <first> <last> <hold s> <scenario>...: question 4. As measure.sh, Squeal only,
# with holder.ts holding all 4 permits of the scratch pool from 1 s before each write for <hold s>.
P=$(dirname "$(readlink -f "$0")"); source "$P/env.sh"
repo=$1 r1=$2 r2=$3 hold=$4; shift 4
R=/tmp/wm119/repos; eval "$(sed -n '/^case \$repo in/,/^run_vitest/p' "$P/measure.sh" | sed '$d')"
for rep in $(seq $r1 $r2); do for sc in "$@"; do for op in apply revert; do
  if [ $op = apply ]; then
    /tmp/wm119/repos/squeal-s/node_modules/.bin/tsx "$P/holder.ts" $hold > /tmp/wm119/logs/holder-$repo-$sc-$rep.out 2>&1 &
    until grep -q held /tmp/wm119/logs/holder-$repo-$sc-$rep.out; do sleep 0.2; done; sleep 1
  fi
  l=$(load); t0=$("$P/edit.sh" $S $sc $op $rep | head -1)
  w=$(node "$P/sq-wait.mjs" $S $(path_of $sc) $t0 600 $(sq_files $sc)); i=$("$P/sq-idle.sh" $S 600)
  echo "{\"tool\":\"squeal\",\"hold\":$hold,\"repo\":\"$repo\",\"sc\":\"$sc\",\"op\":\"$op\",\"rep\":$rep,\"t0\":$t0,\"load\":$l,\"idle\":\"$i\",\"holder\":$(grep -h '^{' /tmp/wm119/logs/holder-$repo-$sc-$rep.out | tail -1 || echo null),\"w\":$w}" >> /tmp/wm119/results-hold.ndjson
  wait; echo "$(date +%T) hold $repo rep $rep $sc $op done"
done; done; done
