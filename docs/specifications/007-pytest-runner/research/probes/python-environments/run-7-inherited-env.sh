#!/usr/bin/env bash
# Q1/Q2: the daemon inherits the spawning hook's environment (001 lessons, defect 13). With an
# activated shell from another worktree, does running this worktree's interpreter by path still
# import this worktree's code, and what does a subprocess started by a test pick up?
set -u; source "$(dirname "$0")/lib.sh"
M=$S/i/main; mkrepo $M; cd $M; uv sync -q --python 3.13
git worktree add -q $S/i/c -b c; C=$S/i/c; cd $C; uv sync -q --python 3.10
sed -i 's/fixture-original/edited-in-c/' src/app/__init__.py
cat > tests/test_sub.py <<'PY'
import subprocess, sys
def test_child_python():
    out = subprocess.run(["python", "-c", "import sys, app; print(sys.version_info[:2], app.MARK)"], capture_output=True, text=True).stdout
    print("CHILD", out.strip(), "PARENT", sys.version_info[:2])
PY
ACT="env VIRTUAL_ENV=$M/.venv PATH=$M/.venv/bin:$PATH"
echo "-- c's .venv/bin/python by path, main's venv activated:"
$ACT EXPECT_MARK=edited-in-c .venv/bin/python -m pytest -q -s -p no:cacheprovider tests/unit/test_app.py::test_which_code tests/test_sub.py 2>&1 | grep -E "APP_FILE|CHILD|passed|failed" | sed "s#$S#<S>#g"
echo "-- the same with VIRTUAL_ENV and PATH set to c's own environment:"
env VIRTUAL_ENV=$C/.venv PATH=$C/.venv/bin:$PATH .venv/bin/python -m pytest -q -s -p no:cacheprovider tests/test_sub.py 2>&1 | grep -E "CHILD|passed|failed"
