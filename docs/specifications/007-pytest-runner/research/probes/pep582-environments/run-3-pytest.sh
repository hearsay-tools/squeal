#!/usr/bin/env bash
# Q2: Squeal's own runtime (squeal_pytest plugin + sitecustomize from src/runners/pytest/runtime)
# combined with a PEP 582 path hook, in both sitecustomize orders; xdist workers; entry-point plugins.
set -u; source "$(dirname "$0")/lib.sh"; load
RT=$(cd $P/../../../../../.. && pwd)/src/runners/pytest/runtime
W=$S/w/main; cd $W; D=$S/q2; rm -rf $D; mkdir -p $D
PDMSC=$S/tools/.venv/lib/python3.13/site-packages/pdm/pep582
for v in 3.13 3.10; do
  case $v in 3.13) PY=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13;; 3.10) PY=$S/pythons/cpython-3.10.20-linux-x86_64-gnu/bin/python3.10;; esac
  L=$W/__pypackages__/$v/lib
  sq() { # $1 name, $2 PYTHONPATH, rest: extra pytest args
    local name=$1 pp=$2; shift 2
    env PYTHONPATH=$pp SQUEAL_PEP582_LIB=$L PEP582_PACKAGES=$W/__pypackages__/$v SQUEAL_PYTEST_ROOT=$W SQUEAL_PYTEST_EVENTS=$D/$v-$name.jsonl \
      PATH=$(dirname $PY):$W/__pypackages__/$v/bin:$PATH \
      $PY -m pytest -p squeal_pytest -p no:cacheprovider -q "$@" tests > $D/$v-$name.out 2>&1
    local rc=$?
    local spawned=$(grep -c '"type": "spawned"' $D/$v-$name.jsonl 2>/dev/null)
    echo "$v $name: exit $rc :: $(tail -1 $D/$v-$name.out | show) :: spawned records ${spawned:-0}: $(grep -o '"to": "[^"]*"' $D/$v-$name.jsonl 2>/dev/null | sed "s#$W/##" | sort -u | tr '\n' ' ')"
  }
  sq squeal-then-boot   "$RT:$P/boot" -n 0
  sq pdmsc-then-squeal  "$PDMSC:$RT"  -n 0
  sq boot-then-squeal   "$P/boot:$RT" -n 0
  sq squeal-then-boot-xdist2 "$RT:$P/boot" -n 2
  echo "-- $v pytest11 plugins loaded under squeal-then-boot: $(grep -o 'plugins: .*' $D/$v-squeal-then-boot.out | head -1)"
  echo "-- $v xdist workers, in-process addsitedir only (no PYTHONPATH):"
  $PY -c "import site,sys; site.addsitedir('$L'); import pytest; sys.exit(pytest.console_main())" -p no:cacheprovider -q -n 2 tests 2>&1 | tail -2 | show
  echo "-- $v xdist workers under pdm run pytest -n 2:"
  $T/pdm use -q -f $PY >/dev/null 2>&1; $T/pdm run pytest -p no:cacheprovider -q -n 2 tests 2>&1 | tail -1 | show
done
echo "-- child python of another minor under pdm run (PEP582_PACKAGES has no version):"
$T/pdm run sh -c 'python -c "import sys, app, django; print(sys.version.split()[0], django.__file__)"' 2>&1 | show
