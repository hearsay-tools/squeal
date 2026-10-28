#!/usr/bin/env bash
# Q2/Q5: a test that imports a Django module not loaded at start-up; how many __pypackages__ files
# Squeal's observed closure (reach.py, observed.ts's walk) takes in under PEP 582.
set -u; source "$(dirname "$0")/lib.sh"; load
RT=$(cd $P/../../../../../.. && pwd)/src/runners/pytest/runtime
W=$S/w/main; cd $W; D=$S/q2c; rm -rf $D; mkdir -p $D
printf 'from django.core.mail import send_mail\n\ndef test_mail_importable():\n    assert send_mail\n' > tests/test_dj.py
PY=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13; L=$W/__pypackages__/3.13/lib
env PYTHONPATH=$RT:$P/boot SQUEAL_PEP582_LIB=$L SQUEAL_PYTEST_ROOT=$W SQUEAL_PYTEST_EVENTS=$D/ev.jsonl \
  $PY -m pytest -p squeal_pytest -p no:cacheprovider -q tests/test_dj.py tests/test_calc.py 2>&1 | tail -1 | show
python3 -I $P/reach.py $D/ev.jsonl $W
rm tests/test_dj.py
