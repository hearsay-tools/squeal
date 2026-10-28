#!/usr/bin/env bash
# Q3: what pdm install, sync, add, remove and use rewrite in a PEP 582 project; pdm.lock against lib/*.dist-info.
set -u; source "$(dirname "$0")/lib.sh"; load
W=$S/w/main; cd $W; D=$S/q3; rm -rf $D; mkdir -p $D
PY13=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13; PY10=$S/pythons/cpython-3.10.20-linux-x86_64-gnu/bin/python3.10
$T/pdm use -q -f $PY13 >/dev/null 2>&1
i=0
step() { # $1 label, rest: command
  local label=$1; shift; i=$((i+1))
  python3 -I $P/snap.py snap $W $D/$i.before
  local s=$(date +%s%N); "$@" > $D/$i.log 2>&1; local rc=$?; local t=$(( ($(date +%s%N)-s)/1000000 ))
  python3 -I $P/snap.py snap $W $D/$i.after
  echo "== $label: exit $rc, $t ms :: $(grep -v '^\s*$' $D/$i.log | tail -1 | show)"
  python3 -I $P/snap.py diff $D/$i.before $D/$i.after
}
step "pdm install (no-op)" $T/pdm install
step "pdm sync (no-op)" $T/pdm sync
step "pdm sync --dry-run (no-op)" $T/pdm sync --dry-run
step "pdm add --no-sync six (lock only)" $T/pdm add --no-sync six
echo "-- lock vs installed after the lock-only add:"; python3 -I $P/lockcheck.py pdm.lock __pypackages__/3.13/lib | show
step "pdm sync --dry-run (behind the lock)" $T/pdm sync --dry-run
echo "   dry-run says: $(grep -i -E 'six|add|install' $D/$i.log | head -3 | tr '\n' ' ')"
step "pdm sync (applies six)" $T/pdm sync
step "pdm remove six" $T/pdm remove six
step "hand install: pip --target lib six (outside PDM)" $PY13 -m pip install -q --no-deps --target __pypackages__/3.13/lib six
step "pdm sync --clean (removes the hand install)" $T/pdm sync --clean
step "pdm use 3.10 (interpreter switch)" $T/pdm use -f $PY10
echo "-- .pdm-python now: $(cat .pdm-python | show); .python-version: $(cat .python-version)"
$T/pdm use -q -f $PY13 >/dev/null 2>&1
echo "-- lock vs installed, fixture 3.13:"; python3 -I $P/lockcheck.py pdm.lock __pypackages__/3.13/lib | show
echo "-- lock vs installed, fixture 3.10:"; python3 -I $P/lockcheck.py pdm.lock __pypackages__/3.10/lib | show
git -C $W checkout -q -- . 2>/dev/null; git -C $W status --short | show
