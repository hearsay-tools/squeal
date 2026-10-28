#!/usr/bin/env bash
# Q2: what sys.path an xdist worker has under pdm run and under the stand-in sitecustomize.
set -u; source "$(dirname "$0")/lib.sh"; load
W=$S/w/main; cd $W; PY=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13
printf 'import os, sys\n\ndef test_where():\n    with open(os.environ["WHERE_LOG"], "a") as f:\n        f.write(os.environ.get("PYTEST_XDIST_WORKER", "main") + " " + repr([p.split("/")[-1] if "site-packages" in p else p.split("/w/main/")[-1] for p in sys.path if "site-packages" in p or "__pypackages__" in p or p.endswith("/src")]) + " NO_SITE_PACKAGES=" + str(os.environ.get("NO_SITE_PACKAGES")) + "\\n")\n' > tests/test_where.py
export WHERE_LOG=$S/where.log; rm -f $WHERE_LOG
echo "-- pdm run python -m pytest -n 2:"; $T/pdm run python -m pytest -p no:cacheprovider -q -n 2 tests/test_where.py tests/test_calc.py 2>&1 | tail -1; cat $WHERE_LOG; rm -f $WHERE_LOG
echo "-- pdm run python -m pytest -n 0:"; $T/pdm run python -m pytest -p no:cacheprovider -q -n 0 tests/test_where.py 2>&1 | tail -1; cat $WHERE_LOG; rm -f $WHERE_LOG
echo "-- stand-in sitecustomize -n 2:"; PYTHONPATH=$P/boot SQUEAL_PEP582_LIB=$W/__pypackages__/3.13/lib $PY -m pytest -p no:cacheprovider -q -n 2 tests/test_where.py tests/test_calc.py 2>&1 | tail -1; cat $WHERE_LOG
rm -f tests/test_where.py $WHERE_LOG
