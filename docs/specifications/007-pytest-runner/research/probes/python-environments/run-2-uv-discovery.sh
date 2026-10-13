#!/usr/bin/env bash
# Q1/Q2: how uv and plain python find an environment in a main checkout, a nested worktree
# (the .ai/cezar/worktrees layout) and a sibling worktree; what an inherited VIRTUAL_ENV does.
set -u; source "$(dirname "$0")/lib.sh"
M=$S/wt/main; mkrepo $M; cd $M
uv sync -q --python 3.13
git worktree add -q .ai/wt/b -b b; git worktree add -q $S/wt/c -b c
B=$M/.ai/wt/b; C=$S/wt/c
WHO='import sys,app; print("exe", sys.executable); print("app", app.__file__)'
echo "== fresh nested worktree b, no .venv"
cd $B; ls -A | tr '\n' ' '; echo
echo "-- .venv/bin/python exists?"; test -x .venv/bin/python && echo yes || echo no
echo "-- uv python find (no project venv yet)"; uv python find 2>&1
echo "-- uv run --no-sync python"; uv run --no-sync python -c "$WHO" 2>&1 | tail -3
echo "-- after --no-sync, .venv exists?"; test -d .venv && { echo yes; ls .venv/lib/*/site-packages | head; } || echo no
echo "-- uv run --frozen python (default sync)"; uv run --frozen python -c "$WHO" 2>&1 | tail -3
echo "-- .venv exists now?"; test -d .venv && echo yes || echo no
rm -rf .venv
echo "== inherited VIRTUAL_ENV pointing at main's .venv, in worktree c (no .venv)"
cd $C
echo "-- python on PATH as an activated shell has it"; PATH=$M/.venv/bin:$PATH VIRTUAL_ENV=$M/.venv python -c "$WHO" 2>&1 | tail -2
echo "-- pytest run that way: which app is imported?"; PATH=$M/.venv/bin:$PATH VIRTUAL_ENV=$M/.venv python -m pytest -q -s tests/unit/test_app.py::test_which_code 2>&1 | grep -E "APP_FILE|passed|failed"
echo "-- uv run --no-sync with VIRTUAL_ENV set"; VIRTUAL_ENV=$M/.venv uv run --no-sync python -c "$WHO" 2>&1 | tail -3
echo "-- uv run --active --no-sync"; VIRTUAL_ENV=$M/.venv uv run --active --no-sync python -c "$WHO" 2>&1 | tail -3
rm -rf .venv
echo "-- uv python find with VIRTUAL_ENV set"; VIRTUAL_ENV=$M/.venv uv python find 2>&1
echo "== UV_PROJECT_ENVIRONMENT shared across worktrees"
mkdir -p $S/wt/shared
UV_PROJECT_ENVIRONMENT=$S/wt/shared/env uv sync -q --python 3.13 2>&1
echo "-- app.pth in the shared env after sync from c:"; cat $S/wt/shared/env/lib/python3.13/site-packages/app.pth; echo
cd $M; UV_PROJECT_ENVIRONMENT=$S/wt/shared/env uv sync -q 2>&1
echo "-- app.pth after a later sync from main:"; cat $S/wt/shared/env/lib/python3.13/site-packages/app.pth; echo
cd $C; echo "-- pytest in c with the shared env: which app?"; $S/wt/shared/env/bin/python -m pytest -q -s tests/unit/test_app.py::test_which_code 2>&1 | grep -E "APP_FILE|passed|failed"
