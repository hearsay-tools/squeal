#!/usr/bin/env bash
# Installs PDM into scratch/tools/.venv and CPython 3.10, 3.11, 3.13 into scratch/pythons.
set -eu; source "$(dirname "$0")/lib.sh"; load
uv python install 3.10 3.11 3.13 2>&1 | tail -4 | show
uv venv -q --python $S/pythons/bin/python3.13 $S/tools/.venv 2>&1 | show || uv venv -q -p 3.13 $S/tools/.venv
uv pip install -q --python $T/python pdm 2>&1 | tail -2 | show
$T/pdm --version
ls $S/pythons | show
