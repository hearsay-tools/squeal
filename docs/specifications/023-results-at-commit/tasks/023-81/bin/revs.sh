#!/bin/bash
# Probe 023-81: 20 unrelated revisions (a docs file no test reads), runs counted before and after.
set -u
S=$1; tag=$2; cd $S/sq
F=docs/specifications/023-results-at-commit/lessons.md
node $S/probe/snap.cjs .git/squeal/store.sqlite $S/sq revs-before > $S/probe/$tag-before.json
for i in $(seq 1 20); do
  echo "probe line $tag $i" >> $F
  sleep 3
  timeout 300 squeal status --wait 240000 > $S/probe/$tag-rev-$i.txt 2>&1
done
sleep 30
timeout 700 squeal status --wait 600000 > $S/probe/$tag-final.txt 2>&1
node $S/probe/snap.cjs .git/squeal/store.sqlite $S/sq revs-after > $S/probe/$tag-after.json
git checkout -q -- $F
echo done
