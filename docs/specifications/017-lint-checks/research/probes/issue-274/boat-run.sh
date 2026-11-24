#!/bin/bash
# Runs on the sandbox: makes the four fixtures, then the probe on each, one at a time.
set -u
W=${W:-$HOME/sq}; P=$W/docs/specifications/017-lint-checks/research/probes/issue-274
OX=$(readlink -f $W/node_modules/oxlint); BB=$(readlink -f $W/node_modules/.pnpm/@babel+parser@7.29.13/node_modules/@babel/parser)
rm -rf /tmp/sq274 && mkdir -p /tmp/sq274 $P/out
node $P/make-fixture.mjs /tmp/sq274/plain plain $OX
node $P/make-fixture.mjs /tmp/sq274/import import $OX
node $P/make-fixture.mjs /tmp/sq274/heavy plain $OX 10 $BB
node $P/make-fixture.mjs /tmp/sq274/heavy-large plain $OX 18 $BB
cd $W
for v in plain import heavy heavy-large; do
  echo "== $v"; TMPDIR=/tmp/sq274 timeout 600 node_modules/.bin/tsx $P/probe.ts /tmp/sq274/$v $P/out/boat-$v.json
done
echo DONE
