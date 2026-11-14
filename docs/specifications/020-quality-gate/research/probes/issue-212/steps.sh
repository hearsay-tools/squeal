#!/bin/sh
# Throwaway (row 020-56). steps.sh <step> ; outputs in /tmp/issue-212/out/<step>.{stdout,stderr,load}.
# Every Squeal call: env -i, HOME and TMPDIR under /tmp/issue-212, nice 10, 8 vCPUs (taskset 0-7),
# the packaged CLI of release 0.1.475 copied to /tmp/issue-212/squeal. Each gate run starts only
# while the one-minute load is below the CPU count (guard.sh); the load is recorded before and after.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WT=$(cd "$HERE/../../../../../.." && pwd)
S=/tmp/issue-212
NODE_BIN=$(dirname "$(command -v node)")
SQUEAL="$S/squeal/dist/cli/squeal.mjs"
N=${N:-300}
run() { # run <cwd> <name> <cmd...>
  cwd=$1; name=$2; shift 2
  "$HERE/guard.sh" true 2>>"$S/out/$name.load" || { echo "skipped" >>"$S/out/$name.load"; return 0; }
  echo "before $(cat /proc/loadavg)" >>"$S/out/$name.load"
  start=$(date +%s.%N)
  ( cd "$cwd" && {
      env -i HOME=$S/home TMPDIR=$S/tmp PATH="$NODE_BIN:/usr/bin:/bin" \
        nice -n 10 taskset -c 0-7 "$@" 1>"$S/out/$name.stdout" && rc=0 || rc=$?
      echo "exit $rc" >>"$S/out/$name.load"; } 2>&1 | node "$HERE/stamp.mjs" >"$S/out/$name.stderr" ) || true
  end=$(date +%s.%N)
  echo "wall $(echo "$end - $start" | bc)" >>"$S/out/$name.load"
  echo "after $(cat /proc/loadavg)" >>"$S/out/$name.load"
}
fixture() { rm -rf "$1"; node "$HERE/fixture.mjs" "$1" "$N" "$2" "$3" "$WT/node_modules"; }
edit() { EDIT_ONLY=1 node "$HERE/fixture.mjs" "$1" "$N" "$2" "$3" "$WT/node_modules"; }
case "$1" in
  setup)
    mkdir -p $S/home $S/tmp $S/out
    [ -d $S/squeal ] || cp -a "$HOME/.claude/plugins/cache/hearsay/squeal/0.1.475" $S/squeal ;;
  cold) # #212's change on N quick files, no store: the whole gate's time, each function's state.
    fixture $S/r-quick 0 setup
    run $S/r-quick cold node "$SQUEAL" code --base main --json --timeout 900 ;;
  warm) # The same repository, setup edited again (keys move); the store now holds every duration.
    edit $S/r-quick 0 setup2
    run $S/r-quick warm node "$SQUEAL" code --base main --json --timeout 900 ;;
  breaks) # A setup change that breaks only the files that call makeClock (every 10th).
    fixture $S/r-breaks 0 breaks
    run $S/r-breaks breaks node "$SQUEAL" code --base main --json --timeout 900 ;;
  sleep-full) # Files of 1 s each (sleep, no CPU): the whole run, which also stores every duration.
    fixture $S/r-sleep 1000 setup
    run $S/r-sleep sleep-full node "$SQUEAL" code --base main --json --timeout 900 ;;
  sleep-tight) # Warm store, keys moved, a budget under half the estimate: the D17.1 lines.
    edit $S/r-sleep 1000 setup2
    run $S/r-sleep sleep-tight node "$SQUEAL" code --base main --json --timeout "${TIGHT:-15}" ;;
  sleep-breaks) # As sleep-tight, with the breaking setup change.
    edit $S/r-sleep 1000 breaks
    run $S/r-sleep sleep-breaks node "$SQUEAL" code --base main --json --timeout "${TIGHT:-15}" ;;
  sleep-top) # As sleep-tight, a top-level-only setup edit: no setup function changed.
    edit $S/r-sleep 1000 top
    run $S/r-sleep sleep-top node "$SQUEAL" code --base main --json --timeout "${TIGHT:-15}" ;;
  sleep-fit) # As sleep-tight with a budget over the estimate: does the warm estimate fit the run?
    edit $S/r-sleep 1000 setup3
    run $S/r-sleep sleep-fit node "$SQUEAL" code --base main --json --timeout 900 ;;
  late-full) # As sleep-full, but only files t20, t30, ... call makeClock (none of the 18 preview loaders).
    CLOCK_FROM=20 fixture $S/r-late 1000 setup
    run $S/r-late late-full node "$SQUEAL" code --base main --json --timeout 900 ;;
  late-breaks) # The breaking setup change under the early stop: the 28 broken files are all left unrun.
    CLOCK_FROM=20 edit $S/r-late 1000 breaks
    run $S/r-late late-breaks node "$SQUEAL" code --base main --json --timeout "${TIGHT:-15}" ;;
  late-breaks-full) # The same bytes with a budget that fits: what the whole run sees.
    run $S/r-late late-breaks-full node "$SQUEAL" code --base main --json --timeout 900 ;;
esac
