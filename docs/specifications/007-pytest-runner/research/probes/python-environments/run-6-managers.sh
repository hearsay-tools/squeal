#!/usr/bin/env bash
# Q1/Q2: Poetry, PDM and Hatch. Where each puts the environment, what file names it, the cost
# of asking the tool, and what each does in a fresh second worktree. HOME is the probe's.
set -u; source "$(dirname "$0")/lib.sh"
export HOME=$S/home XDG_CONFIG_HOME=$S/home/.config XDG_CACHE_HOME=$S/home/.cache XDG_DATA_HOME=$S/home/.local/share
T=$S/tools/.venv/bin; N=3
simple() { # $1 dir, $2 build backend requires, $3 backend
  rm -rf $1; mkdir -p $1/src/app $1/tests; echo 'MARK="x"' > $1/src/app/__init__.py
  printf 'import app\ndef test_mark():\n    assert app.MARK == "x"\n' > $1/tests/test_app.py
  printf '[project]\nname = "app"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = ["pytest>=8"]\n[build-system]\nrequires = ["%s"]\nbuild-backend = "%s"\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n' "$2" "$3" > $1/pyproject.toml
  printf '.venv/\n__pycache__/\n.pytest_cache/\n' > $1/.gitignore
  git -C $1 init -q -b main; git -C $1 add -A; git -C $1 -c user.name=p -c user.email=p@p commit -qm f
}
show() { sed "s#$S#<S>#g"; }
echo "== Poetry $($T/poetry --version)"
simple $S/m/poetry "poetry-core>=2" "poetry.core.masonry.api"; cd $S/m/poetry
$T/poetry env use -q $(uv python find 3.13) 2>&1 | show; $T/poetry install -q 2>&1 | tail -2 | show
echo "-- env path"; $T/poetry env info -p | show; echo "-- new files in the project"; git status --short --ignored | show
ms $T/poetry env info -p | show
git worktree add -q $S/m/poetry-wt -b wt; cd $S/m/poetry-wt
echo "-- fresh worktree: poetry env info -p -> exit $($T/poetry env info -p >/dev/null 2>&1; echo $?)"; $T/poetry env info -p 2>&1 | show
echo "-- fresh worktree: poetry run python (creates an env?)"; $T/poetry run python -c 'import sys;print(sys.prefix)' 2>&1 | tail -2 | show
ls $S/home/.cache/pypoetry/virtualenvs | show
echo "== PDM $($T/pdm --version)"
simple $S/m/pdm "pdm-backend" "pdm.backend"; cd $S/m/pdm
$T/pdm use -q -f $(uv python find 3.13) 2>&1 | tail -1 | show; $T/pdm install -q 2>&1 | tail -2 | show
echo "-- new files in the project"; git status --short --ignored | show; echo "-- .pdm-python"; cat .pdm-python | show; echo
ms $T/pdm info --python | show
git worktree add -q $S/m/pdm-wt -b wt; cd $S/m/pdm-wt
echo "-- fresh worktree: pdm info --python"; $T/pdm info --python 2>&1 | show
echo "== Hatch $($T/hatch --version)"
simple $S/m/hatch "hatchling" "hatchling.build"; cd $S/m/hatch
HATCH_PYTHON=$(uv python find 3.13) $T/hatch env create 2>&1 | tail -1 | show
echo "-- env path"; $T/hatch env find | show; echo "-- new files in the project"; git status --short --ignored | show
ms $T/hatch env find | show
git worktree add -q $S/m/hatch-wt -b wt; cd $S/m/hatch-wt
echo "-- fresh worktree: hatch env find"; $T/hatch env find 2>&1 | show; echo "exists: $(test -d "$($T/hatch env find)" && echo yes || echo no)"
echo "== costs for comparison (uv, files)"; cd $S/w/main 2>/dev/null || cd $S/h/main
ms uv python find | show; ms uv run --frozen --no-sync python -c pass | show; ms .venv/bin/python -c pass | show; ms .venv/bin/python -I -S -c pass | show
ms node $P/envprint.mjs .venv | show
