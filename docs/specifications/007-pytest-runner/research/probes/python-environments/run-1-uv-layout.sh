#!/usr/bin/env bash
# Q1/Q3: what a uv-synced venv records in files, on Python 3.10 and 3.13.
set -u; source "$(dirname "$0")/lib.sh"
for v in 3.10 3.13; do
  R=$S/layout-$v; mkrepo $R; cd $R
  echo "== Python $v"; uv sync -q --python $v 2>&1
  echo "-- .venv/pyvenv.cfg"; cat .venv/pyvenv.cfg
  echo "-- .venv top level"; ls -A .venv
  SP=$(echo .venv/lib/python*/site-packages)
  echo "-- site-packages ($SP)"; ls $SP
  echo "-- *.pth"; for f in $SP/*.pth; do echo "$f: $(cat $f)"; done
  echo "-- direct_url.json of editables"; cat $SP/app-*.dist-info/direct_url.json; echo; cat $SP/lib-*.dist-info/direct_url.json; echo
  echo "-- INSTALLER"; cat $SP/pytest-*.dist-info/INSTALLER
  echo "-- sys from the venv"; .venv/bin/python -c 'import sys,site; print(sys.version); print(sys.implementation.name, sys.implementation.cache_tag); print("prefix", sys.prefix); print("base", sys.base_prefix); print("user site enabled", site.ENABLE_USER_SITE); print("sys.path", sys.path)'
  echo "-- pytest"; .venv/bin/python -m pytest -q 2>&1 | tail -4
done
