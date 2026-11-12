#!/bin/sh
# Throwaway (row 020-41). steps.sh <setup|starve|control|long|hooks> ; outputs in /tmp/gate-budget/out.
# Every Squeal or Vitest call: env -i, HOME and TMPDIR under /tmp/gate-budget, nice 10, 8 vCPUs.
# Each step starts only at a one-minute load of 24 or less (guard.sh).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WT=$(cd "$HERE/../../../../../.." && pwd)
S=/tmp/gate-budget
NODE_BIN=$(dirname "$(command -v node)")
SQUEAL="$S/squeal/dist/cli/squeal.mjs"
run() { # run <cwd> <name> <cmd...>
  cwd=$1; name=$2; shift 2
  "$HERE/guard.sh" true 2>>"$S/out/$name.load"
  cat /proc/loadavg >>"$S/out/$name.load"
  start=$(date +%s.%N)
  ( cd "$cwd" && {
      env -i HOME=$S/home TMPDIR=$S/tmp PATH="$NODE_BIN:/usr/bin:/bin" \
        nice -n 10 taskset -c 0-7 "$@" 1>"$S/out/$name.stdout" && rc=0 || rc=$?
      echo "exit $rc" >>"$S/out/$name.load"; } 2>&1 | node "$HERE/stamp.mjs" >"$S/out/$name.stderr" ) || true
  end=$(date +%s.%N)
  echo "wall $(echo "$end - $start" | bc)" >>"$S/out/$name.load"
  cat /proc/loadavg >>"$S/out/$name.load"
}
case "$1" in
  setup)
    mkdir -p $S/home $S/tmp $S/out
    [ -d $S/squeal ] || cp -a "$HOME/.claude/plugins/cache/hearsay/squeal/0.1.457" $S/squeal
    ;;
  starve) # #196's shape: node:test runs first (fewer files, no store), one file sleeps 60 s.
    node "$HERE/fixture.mjs" $S/r-starve 60 a,b,c "$WT/node_modules"
    run $S/r-starve starve node "$SQUEAL" code --base main --timeout 25 --json ;;
  control) # The same repository with src/a.mjs unchanged: the slow file is not selected.
    node "$HERE/fixture.mjs" $S/r-control 60 b,c "$WT/node_modules"
    run $S/r-control control node "$SQUEAL" code --base main --timeout 25 --json ;;
  long) # The starve repository with a budget that fits: what every runner needs in a row.
    node "$HERE/fixture.mjs" $S/r-long 60 a,b,c "$WT/node_modules"
    run $S/r-long long node "$SQUEAL" code --base main --timeout 180 --json ;;
  hooks) # When Vitest's module hooks fire, 4 files of 2 s, one worker.
    node "$HERE/hooks.mjs" $S/r-hooks "$WT/node_modules" 4
    run $S/r-hooks hooks node "$S/r-hooks/node_modules/vitest/vitest.mjs" run ;;
esac
