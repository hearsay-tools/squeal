#!/usr/bin/env bash
# Q2: an environment whose editable install points at another worktree. Does the test import
# the wrong code, does it change the verdict, and what in the files shows it?
# Also: what setuptools and hatchling editables write, for detection without running Python.
set -u; source "$(dirname "$0")/lib.sh"
M=$S/x/main; mkrepo $M; cd $M; uv sync -q --python 3.13
git worktree add -q $S/x/c -b c; C=$S/x/c
# Worktree c edits app so the test must fail there.
sed -i 's/fixture-original/edited-in-c/' $C/src/app/__init__.py
echo "== c runs with main's .venv (a symlinked or inherited shared env)"
ln -s $M/.venv $C/.venv
cd $C; EXPECT_MARK=edited-in-c .venv/bin/python -m pytest -q -s tests/unit/test_app.py::test_which_code 2>&1 | grep -E "APP_FILE|passed|failed"
echo "-- the same with pythonpath = [\"src\", \"packages/lib/src\"] in [tool.pytest.ini_options]"
sed -i 's/^addopts = "-ra"/addopts = "-ra"\npythonpath = ["src", "packages\/lib\/src"]/' pyproject.toml
EXPECT_MARK=edited-in-c .venv/bin/python -m pytest -q -s tests/unit/test_app.py::test_which_code 2>&1 | grep -E "APP_FILE|passed|failed"
git checkout -q pyproject.toml
echo "-- detection from files: editable roots outside this worktree"
SP=$(echo .venv/lib/python*/site-packages)
for d in $SP/*.dist-info; do f=$d/direct_url.json; [ -f $f ] || continue
  url=$(python3 -c 'import json,sys; j=json.load(open(sys.argv[1])); print(j["url"] if j.get("dir_info",{}).get("editable") else "")' $f)
  [ -n "$url" ] && { case "${url#file://}" in $C|$C/*) w=inside;; *) w=OUTSIDE;; esac; echo "$(basename $d) $w ${url#file://}"; }
done | sed "s#$S#<S>#g"
rm $C/.venv
echo "== setuptools and hatchling editables: what lands in site-packages"
for be in setuptools hatchling; do
  R=$S/x/$be; rm -rf $R; mkdir -p $R/src/pkg_$be; echo "X=1" > $R/src/pkg_$be/__init__.py
  case $be in
    setuptools) printf '[project]\nname="pkg_%s"\nversion="0.1"\n[build-system]\nrequires=["setuptools>=64"]\nbuild-backend="setuptools.build_meta"\n' $be > $R/pyproject.toml;;
    hatchling) printf '[project]\nname="pkg_%s"\nversion="0.1"\n[build-system]\nrequires=["hatchling"]\nbuild-backend="hatchling.build"\n' $be > $R/pyproject.toml;;
  esac
  cd $R; uv venv -q --python 3.10 .venv; uv pip install -q -p .venv/bin/python -e . 2>&1 | tail -2
  SP=$(echo .venv/lib/python*/site-packages)
  echo "-- $be: new files"; ls $SP | grep -iE "pkg|editable|pth" | grep -v _virtualenv
  for f in $SP/*.pth; do case $f in *_virtualenv.pth) ;; *) echo "   $(basename $f): $(cat $f | sed "s#$S#<S>#g")";; esac; done
  cat $SP/pkg_$be-*.dist-info/direct_url.json | sed "s#$S#<S>#g"; echo
done
echo "-- setuptools strict mode (an import-hook finder rather than a path)"
R=$S/x/setuptools; cd $R; uv pip install -q -p .venv/bin/python -e . --config-settings editable_mode=strict 2>&1 | tail -2
SP=$(echo .venv/lib/python*/site-packages); ls $SP | grep -iE "pkg|editable" ; for f in $SP/__editable__*; do echo "   $(basename $f): $(head -c 300 $f | sed "s#$S#<S>#g")"; done
