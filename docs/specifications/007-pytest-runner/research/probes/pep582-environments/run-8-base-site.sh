#!/usr/bin/env bash
# Q1/Q2: a pytest11 plugin in the base interpreter's own site-packages (the dashboard Dockerfile's
# platformdirs case). Which command lines load it, in the pytest process and in xdist workers.
# Writes a fake distribution into the probe-owned 3.13 interpreter under scratch/pythons and removes it at the end.
set -u; source "$(dirname "$0")/lib.sh"; load
W=$S/w/main; cd $W; cp $P/fixture/tests/conftest.py tests/conftest.py
PY=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13; L=$W/__pypackages__/3.13/lib
SITE=$($PY -I -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')
PDMSC=$S/tools/.venv/lib/python3.13/site-packages/pdm/pep582
$T/pdm use -q -f $PY >/dev/null 2>&1
mkdir -p $SITE/leakplug-1.0.dist-info
printf 'Metadata-Version: 2.1\nName: leakplug\nVersion: 1.0\n' > $SITE/leakplug-1.0.dist-info/METADATA
printf '[pytest11]\nleakplug = leakplug\n' > $SITE/leakplug-1.0.dist-info/entry_points.txt
cat > $SITE/leakplug.py <<'PY'
import os
def pytest_configure(config):
    with open(os.environ["LEAK_LOG"], "a") as f:
        f.write(f"loaded pid={os.getpid()} {os.environ.get('PYTEST_XDIST_WORKER', 'main')}\n")
PY
v() { local name=$1; shift; export LEAK_LOG=$S/leak-$name.log; rm -f $LEAK_LOG
  "$@" -p no:cacheprovider -q tests > $S/leak-$name.out 2>&1; local rc=$?
  echo "$name: exit $rc :: $(tail -1 $S/leak-$name.out) :: leakplug loaded in: $(cut -d' ' -f3 $LEAK_LOG 2>/dev/null | sort | uniq -c | tr -s ' ' | tr '\n' ',' || true)"; }
v pdm-run-m-pytest       $T/pdm run python -m pytest -n 0
v pdm-run-m-pytest-n2    $T/pdm run python -m pytest -n 2
v pdmsc-nosite           env PYTHONPATH=$PDMSC PEP582_PACKAGES=$W/__pypackages__/3.13 NO_SITE_PACKAGES=1 $PY -m pytest -n 0
v boot                   env PYTHONPATH=$P/boot SQUEAL_PEP582_LIB=$L $PY -m pytest -n 0
v boot-n2                env PYTHONPATH=$P/boot SQUEAL_PEP582_LIB=$L $PY -m pytest -n 2
v pythonpath-lib         env PYTHONPATH=$L $PY -m pytest -n 0 --deselect tests/test_calc.py
echo "-- dump equality: PDM's sitecustomize + PEP582_PACKAGES + NO_SITE_PACKAGES=1 against pdm run python -m pytest"
D=$S/dumps2; rm -rf $D; mkdir -p $D
DUMP_TO=$D/3.13-pdm-run-m-pytest.json $T/pdm run python -m pytest -p no:cacheprovider -q -n 0 tests >/dev/null 2>&1
DUMP_TO=$D/3.13-plain-nosite.json PYTHONPATH=$PDMSC PEP582_PACKAGES=$W/__pypackages__/3.13 NO_SITE_PACKAGES=1 $PY -m pytest -p no:cacheprovider -q -n 0 tests >/dev/null 2>&1
python3 -I $P/compare.py $D 3.13 pdm-run-m-pytest
rm -rf $SITE/leakplug-1.0.dist-info $SITE/leakplug.py $SITE/__pycache__/leakplug*
echo "-- removed: $(ls $SITE | grep -c leak) leakplug entries left"
