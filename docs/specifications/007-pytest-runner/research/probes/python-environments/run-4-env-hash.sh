#!/usr/bin/env bash
# Q3: what changes the installed set, what changes results, what a sync touches, and the cost of
# a files-only fingerprint.
set -u; source "$(dirname "$0")/lib.sh"
R=$S/h/main; mkrepo $R; cd $R; uv sync -q --python 3.13
SP=$(echo .venv/lib/python*/site-packages)
fp() { node $P/envprint.mjs .venv | sed "s#$S#<S>#g"; }
snap() { stat -c '%Y %i' $SP .venv/bin/python .venv/pyvenv.cfg | tr '\n' ' '; echo; }
echo "== baseline"; fp; snap
sleep 1.1
echo "== uv sync with nothing to do: does anything move?"; uv sync -q; fp; snap
echo "== uv.lock edited (pytest-mock pinned lower) but no sync: installed set"
sed -i 's/"pytest-mock>=3"/"pytest-mock>=3,<3.15"/' pyproject.toml; uv lock -q; git diff --stat | tail -1; fp
echo "== then uv sync"; sleep 1.1; uv sync -q 2>&1; fp; snap
git checkout -q pyproject.toml uv.lock
echo "== uv pip install behind the lock's back (no lockfile change)"; uv pip install -q -p .venv/bin/python 'pytest-mock==3.14.0'; git status --short; fp
uv sync -q
echo "== environment variables that change the verdict"
run() { "$@" .venv/bin/python -m pytest -q -p no:cacheprovider tests/unit 2>&1 | tail -1; }
echo "-- none:                                     $(run env)"
echo "-- PYTEST_ADDOPTS='-p no:pytest_mock':        $(run env PYTEST_ADDOPTS='-p no:pytest_mock')"
echo "-- PYTEST_DISABLE_PLUGIN_AUTOLOAD=1:          $(run env PYTEST_DISABLE_PLUGIN_AUTOLOAD=1)"
echo "-- ... plus PYTEST_PLUGINS=pytest_mock:       $(run env PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTEST_PLUGINS=pytest_mock)"
mkdir -p $S/h/shadow/app; echo 'MARK="shadow"; quadruple=lambda x: 0' > $S/h/shadow/app/__init__.py
echo "-- PYTHONPATH=<a directory with another app>:  $(run env PYTHONPATH=$S/h/shadow)"
echo "== Python version change: .python-version 3.13 -> 3.10 then uv sync"
before=$(stat -c %i .venv/bin/python); echo 3.10 > .python-version; uv sync -q 2>&1; echo "python inode changed: $([ "$before" != "$(stat -c %i .venv/bin/python)" ] && echo yes || echo no)"; fp
