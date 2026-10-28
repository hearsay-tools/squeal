#!/usr/bin/env bash
# Q5: Squeal's static graph (createPytestGraph, files only, no Python started) on the fixture and the dashboard,
# with __pypackages__/X.Y/lib absent (today's PEP 582 state), as a pythonpath entry, and as a venv-shaped environment.
set -u; P=$(cd "$(dirname "$0")" && pwd); S=$P/scratch; load() { echo "load(1m) $(cut -d' ' -f1 /proc/loadavg) on $(nproc) CPUs"; }
TSX=$(cd $P/../../../../../.. && pwd)/node_modules/.bin/tsx
W=$S/w/main
echo "== fixture (3.13 lib)"; load
for m in none lib-as-pythonpath lib-as-env; do $TSX $P/graph-probe.ts $W $W $m $W/__pypackages__/3.13/lib | sed "s#$S#<S>#g"; done
R=$HOME/projects/saas-bp-management-dashboard
for p in backend workers; do
  echo "== dashboard packages/$p (read only)"; load
  for m in none lib-as-env; do $TSX $P/graph-probe.ts $R $R/packages/$p $m $R/packages/$p/__pypackages__/3.11/lib; done
done
echo "== dashboard packages/workers, lib as a pythonpath entry (read only)"; load
$TSX $P/graph-probe.ts $R $R/packages/workers lib-as-pythonpath $R/packages/workers/__pypackages__/3.11/lib
