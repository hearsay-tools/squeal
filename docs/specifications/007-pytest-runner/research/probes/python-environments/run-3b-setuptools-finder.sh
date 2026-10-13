#!/usr/bin/env bash
# Q2: setuptools' import-hook editable, used when a package directory is renamed by package_dir.
set -u; source "$(dirname "$0")/lib.sh"
R=$S/x/finder; rm -rf $R; mkdir -p $R/code; echo "X=1" > $R/code/__init__.py
printf '[project]\nname="pkgf"\nversion="0.1"\n[build-system]\nrequires=["setuptools>=64"]\nbuild-backend="setuptools.build_meta"\n[tool.setuptools]\npackages=["pkgf"]\npackage-dir={pkgf="code"}\n' > $R/pyproject.toml
cd $R; uv venv -q --python 3.13 .venv; uv pip install -q -p .venv/bin/python -e . 2>&1 | tail -2
SP=$(echo .venv/lib/python*/site-packages); ls $SP | grep -iE "pkgf|editable"
for f in $SP/__editable__*.pth; do echo "$(basename $f): $(cat $f)"; done
grep -E "^MAPPING|^NAMESPACES" $SP/__editable___pkgf_*finder.py | sed "s#$S#<S>#g"
.venv/bin/python -c 'import pkgf; print(pkgf.__file__)' | sed "s#$S#<S>#g"
