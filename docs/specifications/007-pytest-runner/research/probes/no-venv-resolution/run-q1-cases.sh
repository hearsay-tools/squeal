#!/usr/bin/env bash
# Throwaway (007-04) Q1: sync commands and settings that make the derived roots differ from what uv wrote.
# Copies fixtures/layouts to work/cases/<case>, applies one change, syncs, compares derived with actual roots.
set -uo pipefail
P="$(cd "$(dirname "$0")" && pwd)"; source "$P/env.sh"
W=$P/work/cases; rm -rf $W; mkdir -p $W
mk() { rm -rf $W/$1; cp -r $P/fixtures/layouts $W/$1; rm -rf $W/$1/.venv* $W/$1/.pytest_cache; }
cmp() { node $P/roots.mjs derive $W/$1 > $W/$1.d.json; node $P/roots.mjs actual $W/$1 > $W/$1.a.json
  node -e "const r=JSON.parse(require('child_process').execFileSync('node',['$P/cmp_roots.mjs','$W/$1.d.json','$W/$1.a.json']));console.log('$1:', r.entries_equal_in_order&&r.mappings_equal?'EQUAL':'DIFFER', 'only derived', JSON.stringify(r.only_derived), 'only actual', JSON.stringify(r.only_actual))"; }
orphan() { mkdir -p $W/$1/packages/orphan/src/orphan; printf '[project]\nname = "orphan"\nversion = "0.1.0"\n[build-system]\nrequires = ["uv_build>=0.8,<0.13"]\nbuild-backend = "uv_build"\n' > $W/$1/packages/orphan/pyproject.toml; touch $W/$1/packages/orphan/src/orphan/__init__.py; }
mk default; (cd $W/default && uv sync -q -p 3.13); cmp default
mk orphan-default; orphan orphan-default; (cd $W/orphan-default && uv sync -q -p 3.13); cmp orphan-default
mk orphan-all; orphan orphan-all; (cd $W/orphan-all && uv sync -q -p 3.13 --all-packages); cmp orphan-all
mk no-install-project; (cd $W/no-install-project && uv sync -q -p 3.13 --no-install-project); cmp no-install-project
mk package-false; sed -i 's/^\[tool.uv.workspace\]/[tool.uv]\npackage = false\n\n[tool.uv.workspace]/' $W/package-false/pyproject.toml; (cd $W/package-false && uv sync -q -p 3.13); cmp package-false
mk no-build-system; sed -i '/^\[build-system\]/,/^build-backend/d' $W/no-build-system/pyproject.toml; (cd $W/no-build-system && uv sync -q -p 3.13); cmp no-build-system
mk no-editable; (cd $W/no-editable && uv sync -q -p 3.13 --no-editable); cmp no-editable
mk hatch-sources; printf '[tool.hatch.build.targets.wheel]\npackages = ["src/hauto"]\nsources = ["src"]\n' >> $W/hatch-sources/packages/hauto/pyproject.toml; (cd $W/hatch-sources && uv sync -q -p 3.13 2>&1 | tail -1); cmp hatch-sources
mk hatch-only-include; printf '[tool.hatch.build.targets.wheel]\nonly-include = ["src/hauto", "src/shared.py"]\nsources = ["src"]\n' >> $W/hatch-only-include/packages/hauto/pyproject.toml; (cd $W/hatch-only-include && uv sync -q -p 3.13 2>&1 | tail -1); cmp hatch-only-include
mk setuptools-two-where; sed -i 's/^where = \["lib"\]/where = ["lib", "extra"]/' $W/setuptools-two-where/packages/sfind/pyproject.toml; mkdir -p $W/setuptools-two-where/packages/sfind/extra/sfind_extra; touch $W/setuptools-two-where/packages/sfind/extra/sfind_extra/__init__.py; (cd $W/setuptools-two-where && uv sync -q -p 3.13 2>&1 | tail -1); cmp setuptools-two-where
