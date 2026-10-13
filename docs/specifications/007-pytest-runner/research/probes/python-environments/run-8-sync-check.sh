#!/usr/bin/env bash
# Q3: can a reader tell, without changing anything, that the environment is behind uv.lock?
set -u; source "$(dirname "$0")/lib.sh"
R=$S/k/main; mkrepo $R; cd $R; uv sync -q --python 3.13
fp() { node $P/envprint.mjs .venv | cut -d, -f1; }
uv sync --check >/dev/null 2>&1; echo "synced: uv sync --check exit $?"
uv pip install -q -p .venv/bin/python six; uv sync --check >/dev/null 2>&1; echo "extra package installed by hand: exit $?"; uv sync -q
sed -i 's/"pytest-mock>=3"/"pytest-mock>=3,<3.15"/' pyproject.toml; uv lock -q
b=$(fp); uv sync --check >/dev/null 2>&1; echo "uv.lock changed, not synced: exit $?; environment untouched by --check: $([ "$b" = "$(fp)" ] && echo yes || echo no)"
N=3 ms uv sync --check
echo "-- RECORD hashing cost (numpy+pandas env from run-5, if present)"; [ -d $S/w/main/.venv ] && node $P/recordcost.mjs $S/w/main/.venv
