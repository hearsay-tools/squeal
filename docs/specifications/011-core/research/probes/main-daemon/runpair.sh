#!/bin/sh
# 011-157 probe (throwaway): start the shipped bundle's daemon in the probe's main checkout and linked worktree (lookup-only, runs no test),
# wait for both to key, stop both, copy the probe store. Usage: sh runpair.sh <out dir>
S=/tmp/md157; B=$S/bundle/dist/cli/squeal.mjs; d=$S/x/main; l=$d/.ai/cezar/worktrees/l; out=$1; mkdir -p "$out"
for w in $d $l; do (cd $w && $S/envrun.sh node $B start $w | head -3); done
for w in $d $l; do (cd $w && $S/envrun.sh node $B status --wait 600000 | head -4); done
for w in $d $l; do (cd $w && $S/envrun.sh node $B stop $w | head -2); done
cp $d/.git/squeal/store.sqlite* "$out"/
