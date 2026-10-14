#!/usr/bin/env bash
# Throwaway (007-04) Q3: two worktrees of one commit, each synced from the same uv.lock: which D2 inputs differ?
set -uo pipefail
P="$(cd "$(dirname "$0")" && pwd)"; source "$P/env.sh"
W=$P/work/q3wt; rm -rf $W; mkdir -p $W
for wt in a b; do cp -r $P/work/fix/small $W/$wt; rm -rf $W/$wt/.venv*; (cd $W/$wt && uv sync -q -p 3.13 --locked); node $P/envinputs.mjs $W/$wt/.venv > $W/$wt.json; done
node -e "const a=require('$W/a.json'), b=require('$W/b.json'); for (const k of Object.keys(a)) console.log(a[k]===b[k]?'same  ':'DIFFER', k)"
echo "-- uv.lock identical: $(cmp -s $W/a/uv.lock $W/b/uv.lock && echo yes || echo no)"
echo "-- sample bytes (b's path replaced by <wt>):"; cat $W/b/.venv/lib/python3.13/site-packages/_editable_impl_app.pth | sed "s#$W/b#<wt>#"; echo; cat $W/b/.venv/lib/python3.13/site-packages/app-0.1.0.dist-info/direct_url.json | sed "s#$W/b#<wt>#"; echo; cat $W/b/.venv/pyvenv.cfg | sed "s#$P#<probe>#"
