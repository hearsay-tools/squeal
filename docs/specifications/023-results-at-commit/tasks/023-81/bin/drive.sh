#!/bin/bash
# Probe 023-81 step A: one run of every folder-listing test, then an idle minute.
set -u
S=$1; cd $S/sq
node $S/probe/tree.cjs $S/sq > $S/probe/tree-0.json
date -u +%FT%T.%3NZ > $S/probe/t-ask
timeout 2400 squeal status --wait 2300000 $(cat $S/probe/listing-tests.txt) > $S/probe/ask1.txt 2>&1
echo "exit $?" >> $S/probe/ask1.txt
date -u +%FT%T.%3NZ > $S/probe/t-done
node $S/probe/snap.cjs .git/squeal/store.sqlite $S/sq done > $S/probe/snap-1.json
node $S/probe/tree.cjs $S/sq > $S/probe/tree-1.json
timeout 700 squeal status --wait 600000 > $S/probe/idle1.txt 2>&1
sleep 60
node $S/probe/snap.cjs .git/squeal/store.sqlite $S/sq idle > $S/probe/snap-2.json
node $S/probe/tree.cjs $S/sq > $S/probe/tree-2.json
echo done
