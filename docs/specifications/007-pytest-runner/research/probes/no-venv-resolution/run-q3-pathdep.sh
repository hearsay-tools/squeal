#!/usr/bin/env bash
# Throwaway (007-04) Q3: a non-editable path dependency inside the worktree. Its source is not in uv.lock;
# what does a sync install after the source changes, and does anything notice?
set -uo pipefail
P="$(cd "$(dirname "$0")" && pwd)"; source "$P/env.sh"
W=$P/work/q3path; rm -rf $W; mkdir -p $W; cp -r $P/fixtures/layouts $W/wt; rm -rf $W/wt/.venv*; cd $W/wt
uv sync -q -p 3.13 --locked
S=.venv/lib/python3.13/site-packages
inst() { cat $S/pathdep/__init__.py | tr '\n' ' '; }
L0=$(sha256sum uv.lock | cut -c1-12)
echo "synced: installed pathdep = '$(inst)'"
echo 'VALUE = 2' > vendor/pathdep/src/pathdep/__init__.py
uv lock --check -q >/dev/null 2>&1; echo "source edited: uv lock --check exit $? | uv.lock changed: $([ $L0 = $(sha256sum uv.lock | cut -c1-12) ] && echo no || echo yes)"
uv sync --check -q >/dev/null 2>&1; echo "source edited: uv sync --check exit $?"
uv sync -q --locked; echo "after uv sync: installed pathdep = '$(inst)'"
uv sync -q --locked --reinstall-package pathdep; echo "after --reinstall-package pathdep: installed pathdep = '$(inst)'"
echo "-- direct_url.json of the copy:"; sed "s#$W/wt#<wt>#" $S/pathdep-0.1.0.dist-info/direct_url.json; echo
echo "-- uv.lock entry:"; grep -A3 '^name = "pathdep"' uv.lock | sed "s#$W/wt#<wt>#"
