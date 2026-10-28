#!/usr/bin/env bash
# Q1/Q2: the same pytest session under `pdm run` and under plain command lines, on 3.13 and 3.10.
# Each variant dumps sys.path, imports, distributions, pytest11 entry points and loaded plugins
# (tests/conftest.py, DUMP_TO), then runs the suite once.
set -u; source "$(dirname "$0")/lib.sh"; load
W=$S/w/main; cd $W; cp $P/fixture/tests/conftest.py tests/conftest.py
D=$S/dumps; rm -rf $D; mkdir -p $D
PDMSC=$S/tools/.venv/lib/python3.13/site-packages/pdm/pep582
for v in 3.13 3.10; do
  case $v in 3.13) PY=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13;; 3.10) PY=$S/pythons/cpython-3.10.20-linux-x86_64-gnu/bin/python3.10;; esac
  $T/pdm use -q -f $PY >/dev/null 2>&1
  L=$W/__pypackages__/$v/lib
  run() { # $1 variant name, rest: command (env assignments via env)
    local name=$1; shift
    DUMP_TO=$D/$v-$name.json "$@" -p no:cacheprovider -q -n 0 tests > $D/$v-$name.out 2>&1
    echo "$v $name: exit $? :: $(tail -1 $D/$v-$name.out | show)"
  }
  run pdm-run-pytest      $T/pdm run pytest
  run pdm-run-m-pytest    $T/pdm run python -m pytest
  run pdmsc-pythonpath    env PYTHONPATH=$PDMSC $PY -m pytest
  run pythonpath-lib      env PYTHONPATH=$L PATH=$W/__pypackages__/$v/bin:$PATH $PY -m pytest
  run boot-sitecustomize  env PYTHONPATH=$P/boot SQUEAL_PEP582_LIB=$L $PY -m pytest
  run addsitedir-inproc   $PY -c "import site,sys; site.addsitedir('$L'); import pytest; sys.argv[0]='pytest'; sys.exit(pytest.console_main())"
  run isolated-I          env PYTHONPATH=$L $PY -I -m pytest
done
echo "which python on PATH: $(command -v python) -> $(python -c 'import sys;print(sys.version.split()[0])' 2>&1)"
