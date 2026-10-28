#!/usr/bin/env bash
# Q4: a fresh worktree nested inside the main checkout (Cezar's layout). What it inherits through
# PDM's directory walk, what `pdm run` and `pdm install` write there and where, with install.cache on and off.
set -u; source "$(dirname "$0")/lib.sh"; load
W=$S/w/main; N=$W/.ai/wt/n1; cd $W
PDMSC=$S/tools/.venv/lib/python3.13/site-packages/pdm/pep582
PY13=$S/pythons/cpython-3.13.14-linux-x86_64-gnu/bin/python3.13
$T/pdm use -q -f $PY13 >/dev/null 2>&1
git worktree remove --force $N 2>/dev/null; rm -rf $W/.ai; git branch -D n1 -q 2>/dev/null
git worktree add -q $N -b n1
cd $N
echo "== fresh nested worktree: tracked files only; __pypackages__: $(ls -d __pypackages__ 2>/dev/null || echo none); .pdm-python: $(cat .pdm-python 2>/dev/null || echo none)"
echo "-- PDM's sitecustomize without PEP582_PACKAGES (the 'pdm --pep582' shell setup) walks up from the cwd:"
PYTHONPATH=$PDMSC $PY13 -c "import app, sys; print('app from', app.__file__); print('lib dir', [p for p in sys.path if '__pypackages__' in p])" 2>&1 | show
echo "-- same with PEP582_PACKAGES naming this worktree (no such dir yet):"
PYTHONPATH=$PDMSC PEP582_PACKAGES=$N/__pypackages__/3.13 $PY13 -c "import app; print('app from', app.__file__)" 2>&1 | tail -1 | show
echo "-- what 'pdm --pep582 bash' prints (the shell integration):"; $T/pdm --pep582 bash 2>&1 | show
python3 -I $P/snap.py snap $N $S/q4.0; touch $S/marker4
echo "== pdm run python (no install yet) in the fresh worktree"
$T/pdm run python -c "import app; print('app from', app.__file__)" 2>&1 | tail -2 | show
echo "-- .pdm-python after pdm run: $(cat .pdm-python 2>/dev/null | show || echo none)"
python3 -I $P/snap.py snap $N $S/q4.1; python3 -I $P/snap.py diff $S/q4.0 $S/q4.1
echo "== pdm install in the fresh worktree (install.cache default: off)"
s=$(date +%s%N); $T/pdm install 2>&1 | tail -1 | show; echo "   $(( ($(date +%s%N)-s)/1000000 )) ms"
python3 -I $P/snap.py snap $N $S/q4.2; python3 -I $P/snap.py diff $S/q4.1 $S/q4.2 | grep -v "same bytes"
echo "-- files written outside the worktree by pdm run + pdm install (by top directory under scratch):"
find $S -newer $S/marker4 -type f -not -path "$N/*" -not -path "$S/q4*" | sed "s#$S/##" | cut -d/ -f1-2 | sort | uniq -c
echo "-- real HOME: PDM-named paths newer than the marker: $(find /home/agent -maxdepth 5 -newer $S/marker4 -ipath '*pdm*' -not -path '/home/agent/projects/*' 2>/dev/null | wc -l)"
echo "-- minors installed: $(ls __pypackages__ | tr '\n' ' '); editable .pth name: $(cat __pypackages__/*/lib/*.pth | show | tr '\n' ' ')"
echo "== install.cache = true in a second fresh worktree"
N2=$W/.ai/wt/n2; git -C $W worktree add -q $N2 -b n2; cd $N2
$T/pdm config -l install.cache true; $T/pdm use -q -f $PY13 >/dev/null 2>&1
$T/pdm install 2>&1 | tail -1 | show
echo "-- symlinks under lib (any depth): $(find __pypackages__/3.13/lib -type l | wc -l), regular files: $(find __pypackages__/3.13/lib -type f | wc -l); link targets outside the worktree: $(find __pypackages__/3.13/lib -type l -exec readlink -f {} \; | grep -vc "^$N2/")"
echo "-- e.g. $(find __pypackages__/3.13/lib -type l | head -2 | while read l; do echo "$l -> $(readlink $l)"; done | show | tr '\n' ' ')"
echo "-- .pth files: $(ls __pypackages__/3.13/lib/*.pth | xargs -n1 basename | tr '\n' ' ')"
echo "-- pdm.toml after pdm config -l: $(tr '\n' ' ' < pdm.toml)"
PYTHONPATH=$P/boot SQUEAL_PEP582_LIB=$N2/__pypackages__/3.13/lib $PY13 -m pytest -q -p no:cacheprovider tests 2>&1 | tail -1
cd $W; git worktree remove --force $N; git worktree remove --force $N2; git branch -D -q n1 n2; rm -rf $W/.ai
