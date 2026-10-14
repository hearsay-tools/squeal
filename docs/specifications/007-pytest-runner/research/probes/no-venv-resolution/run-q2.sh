#!/usr/bin/env bash
# Throwaway (007-04) Q2: closures without an environment against the synced one.
# run-q2.sh <name> <root> <venv dir name> [declared editable dirs...]
# Graphs: ast  = ast_graph.py in the venv (the oracle), node = graph.mjs reading the venv,
#         noenv = graph.mjs from roots.mjs's derived roots only; -sym = winners outside the worktree do not
#         end the candidate scan; -std = the interpreter's stdlib names stand in for the stdlib directory.
set -euo pipefail
P="$(cd "$(dirname "$0")" && pwd)"; source "$P/env.sh"
N=$1; R=$2; V=$3; shift 3
O=$P/results/q2; mkdir -p $O
TS="--parser=treesitter --skip-type-checking"
PV=$(sed -n 's/^version_info = \([0-9]*\.[0-9]*\).*/\1/p' $R/$V/pyvenv.cfg)
STD="--stdlib=$P/results/stdlib-$PV.txt"
node $P/roots.mjs derive $R "$@" > $O/$N.derived.json
"$R/$V/bin/python" -I $P/ast_graph.py $R $O/$N.$V.ast.json --skip-type-checking > /dev/null
node $P/graph.mjs $R $O/$N.$V.node.json $TS --venv=$V > /dev/null
node $P/graph.mjs $R $O/$N.$V.node-sym.json $TS --venv=$V --sym > /dev/null
node $P/graph.mjs $R $O/$N.noenv.json $TS --roots=$O/$N.derived.json > /dev/null
node $P/graph.mjs $R $O/$N.noenv-sym.json $TS --roots=$O/$N.derived.json --sym > /dev/null
node $P/graph.mjs $R $O/$N.$PV.noenv-std-sym.json $TS --roots=$O/$N.derived.json --sym $STD > $O/$N.noenv.timing
s() { node $P/cmp_closures.mjs $R $1 $2 > $O/$N.$V.$3.cmp.json; node -e "const r=require('$O/$N.$V.$3.cmp.json'); console.log('$N $PV $3: tests', r.tests, '| files differ', r.closure_files_differ, '| candidates differ', r.candidates_differ, '|', r.most_common.slice(0,3).map(x=>x[0]+' x'+x[1]).join('; '))"; }
s $O/$N.$V.ast.json $O/$N.$V.node.json "oracle~node(venv)"
s $O/$N.$V.node.json $O/$N.noenv.json "node(venv)~noenv"
s $O/$N.$V.node-sym.json $O/$N.noenv-sym.json "sym:node(venv)~noenv"
s $O/$N.$V.node-sym.json $O/$N.$PV.noenv-std-sym.json "sym:node(venv)~noenv+stdlib"
