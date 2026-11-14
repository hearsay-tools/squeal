#!/bin/sh
# Throwaway: two new files that change what a pytest file imports while no file
# of its recorded loaded set (Squeal's own plugin, squeal_reach.py) changes:
# (1) a new tests/util.py shadows lib/util.py (pytest's prepend import mode puts
# tests/ first on sys.path); (2) a new nsx/__init__.py turns namespace package
# nsx into a regular package whose __init__ now runs.
# Usage: shadow-demo.sh <scratch dir> <python with pytest> <squeal runtime dir> <probe dir>
set -e
D=$1; PY=$2; RT=$3; PR=$4
rm -rf "$D"; mkdir -p "$D/lib" "$D/tests" "$D/nsx"; cd "$D"
printf '[pytest]\npythonpath = lib .\naddopts = -p no:cacheprovider\n' > pytest.ini
echo 'WHO = "lib/util.py"' > lib/util.py
echo 'M = 1' > nsx/mod.py
printf 'import util\nimport nsx.mod\n\ndef test_s():\n    assert util.WHO == "lib/util.py"\n    assert getattr(nsx, "FLAG", None) is None\n' > tests/test_s.py
run() {
  rm -f ev.jsonl
  SQUEAL_PYTEST_ROOT=$D SQUEAL_PYTEST_EVENTS=$D/ev.jsonl PYTHONPATH=$RT PYTHONDONTWRITEBYTECODE=1 "$PY" -m pytest -q -p squeal_pytest tests/test_s.py 2>&1 | tail -1
  python3 "$PR/squeal_reach.py" ev.jsonl "$D" tests/test_s.py
}
echo "== before"; run
echo 'WHO = "tests/util.py"' > tests/util.py
echo "== after new tests/util.py"; run || true
rm tests/util.py
echo 'FLAG = "nsx/__init__.py ran"' > nsx/__init__.py
echo "== after new nsx/__init__.py"; run || true
