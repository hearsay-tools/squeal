#!/usr/bin/env bash
# Q7: whether PDM_USE_VENV overrides the tracked pdm.toml's use_venv = false, giving a worktree an
# ordinary in-project .venv that Squeal already supports, with pdm.toml untouched.
set -u; source "$(dirname "$0")/lib.sh"; load
W=$S/w/main; N=$W/.ai/wt/n3; cd $W
PY13=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13
git worktree remove --force $N 2>/dev/null; git branch -D -q n3 2>/dev/null
git worktree add -q $N -b n3; cd $N; cp $W/pdm.lock .
s=$(date +%s%N); PDM_USE_VENV=true $T/pdm use -q -f $PY13 2>&1 | tail -1 | show; PDM_USE_VENV=true $T/pdm install 2>&1 | tail -1 | show; echo "   $(( ($(date +%s%N)-s)/1000000 )) ms"
echo "-- .venv/pyvenv.cfg: $(test -f .venv/pyvenv.cfg && echo exists || echo missing); __pypackages__: $(ls -d __pypackages__ 2>/dev/null || echo none); .pdm-python: $(cat .pdm-python | show)"
echo "-- tracked files changed: $(git status --short --untracked-files=no | wc -l); pdm.toml: $(tr '\n' ' ' < pdm.toml)"
echo "-- .venv/bin/python -m pytest, PATH unchanged: $(.venv/bin/python -m pytest -q -p no:cacheprovider tests 2>&1 | grep -E "^FAILED|passed|failed" | sed "s/ - .*//" | tr "\n" " ")"
echo "-- with .venv/bin first on PATH (D2): $(PATH=$N/.venv/bin:$PATH .venv/bin/python -m pytest -q -p no:cacheprovider tests 2>&1 | tail -1)"
echo "-- plain 'pdm run' afterwards (no PDM_USE_VENV) uses: $($T/pdm run python -c 'import sys;print(sys.prefix)' 2>&1 | tail -1 | show)"
cd $W; git worktree remove --force $N; git branch -D -q n3
