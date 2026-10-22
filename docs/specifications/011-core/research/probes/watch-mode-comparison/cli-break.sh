#!/bin/bash
# cli-break.sh <rep>: a cli.py edit that breaks the CLI (`raise SystemExit(3)` first), in the pytest clone:
# plain pytest, then pytest --testmon, then the revert and both again. Correctness only (011-115 E9's edit).
source "$(dirname "$0")/env.sh"; cd /tmp/wm119/repos/toolkit-p/plugin-tools/estimate-pricing
f=estimate_pricing/cli.py
sed -i "1i raise SystemExit(3)  # wm$1" $f
a=$(date +%s.%N); p=$(.venv/bin/python -m pytest -q -p no:cacheprovider -p no:testmon 2>&1 | tail -1); b=$(date +%s.%N)
t=$(.venv/bin/python -m pytest -q --testmon 2>&1 | tail -1); c=$(date +%s.%N)
git checkout -q -- $f
p2=$(.venv/bin/python -m pytest -q -p no:cacheprovider -p no:testmon 2>&1 | tail -1); t2=$(.venv/bin/python -m pytest -q --testmon 2>&1 | tail -1)
echo "rep $1 break: plain [$p] $(echo "$b - $a" | bc) s; testmon [$t] $(echo "$c - $b" | bc) s | revert: plain [$p2]; testmon [$t2]"
