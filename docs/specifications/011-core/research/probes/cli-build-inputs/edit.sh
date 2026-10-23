#!/usr/bin/env bash
# Throwaway probe for 011-127: makes one sample edit in the scratch clone (the src/ diff of a commit, reversed),
# waits for the daemon to settle with measure.sh, records what ran, then restores and settles again.
# usage: edit.sh <label> <commit>
source "$(dirname "$0")/env.sh"
label=$1 commit=$2 here=$(cd "$(dirname "$0")" && pwd)
t0=$(date +%s%3N)
(cd $C && git show $commit -- src | git apply -R) || exit 1
sleep 2
echo "$label edited: $(cd $C && git status --short | tr '\n' ' ')" >> $R/measure.log
"$here/measure.sh" $label
node "$here/ran.mjs" $t0 $R/gap-c0.json > $R/ran-$label.json
(cd $C && git checkout -q -- src)
t1=$(date +%s%3N)
"$here/measure.sh" $label-restore
node "$here/ran.mjs" $t1 $R/gap-c0.json > $R/ran-$label-restore.json
