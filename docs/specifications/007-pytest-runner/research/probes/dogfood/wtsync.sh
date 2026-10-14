#!/bin/sh
# Throwaway probe for 007-18: a session worktree's environment, as squeal-e2e.
#   sh wtsync.sh <worktree dir> <out file> <early|late>
#   early  the daemon starts before the environment exists (D2's note), and the environments are
#          created and installed while it runs, status polled every second (open question 7);
#          then `run --all --wait`, timed
#   late   the environments first, then the daemon and `run --all --wait`, timed (goal 2)
set -u
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/sq07-18
wt=$1
out=$2
mode=$3
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
now() { date -u +%T.%N | cut -c1-12; }
sync() {
  echo "$(now) sync root: uv venv"
  as "$wt" uv venv -q --python 3.13 --managed-python .venv
  echo "$(now) sync root: uv pip install -e . --group test"
  as "$wt" uv pip install -q -e . --group test
  echo "$(now) sync debugger: uv venv"
  as "$wt/debugger" uv venv -q --python 3.13 --managed-python .venv
  echo "$(now) sync debugger: uv pip install -e .[pdb,debugpy] --group test"
  as "$wt/debugger" uv pip install -q -e '.[pdb,debugpy]' --group test
  echo "$(now) sync done"
}
{
  echo "== $wt $mode start $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"
  if [ "$mode" = early ]; then
    as "$wt" squeal start
    as "$wt" squeal status
    ( while :; do
        printf '%s poll | %s | %s\n' "$(now)" \
          "$(as "$wt" squeal status 2>&1 | grep -m1 '^Affected')" \
          "$(as "$wt" squeal status 2>&1 | grep -E 'environment|sync|pytest project' | tail -2 | tr '\n' ' ' | cut -c1-400)"
        sleep 1
      done ) &
    poll=$!
    sync
    sleep 5
    kill "$poll" 2>/dev/null
  else
    sync
    as "$wt" squeal start
  fi
  echo "$(now) run --all --wait, load $(cut -d' ' -f1 /proc/loadavg)"
  t0=$(date +%s.%N)
  as "$wt" squeal run --all --wait
  echo "$(now) run --all --wait exit $? wall $(echo "$(date +%s.%N) - $t0" | bc) s load $(cut -d' ' -f1 /proc/loadavg)"
  as "$wt" squeal status
} > "$out" 2>&1
tail -25 "$out"
