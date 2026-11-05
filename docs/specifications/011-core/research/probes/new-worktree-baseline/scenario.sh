#!/bin/sh
# 011-299 fixture scenario (throwaway). Run after fixture.sh, from env.sh-free shell: each step calls cycle.sh.
#  M  main validated (8 files)
#  B1 worktree fxb1 off main: src/a.ts changed and committed, validated (a, h re-key)
#  B2 worktree fxb2 off main: src/b.ts changed and committed, validated (b, h re-key)
#  S  main squash-merges B1, then B2 (as cezar's GitHub squash merges): its tree has a and b changed, never validated
#  N  new worktree fxn at S: which files does its first baseline run?
#  P  main commits a change to src/c.ts; two new worktrees fxp1, fxp2 at it start at the same moment
set -e
X=${X:-$TMPDIR/nw/x}; P=$(cd "$(dirname "$0")" && pwd); SQ=${SQ:?squeal checkout}; export X SQ
E="$P/env.sh"; FX=$X/fx
# wt <name> <commit> [-b <branch> | --detach]: a linked worktree at $X/<name> with the fixture's node_modules link
wt() { n=$1; c=$2; shift 2; $E git -C $FX worktree add -q "$@" "$X/$n" "$c"; ln -s "$(readlink $FX/node_modules)" "$X/$n/node_modules"; }
$P/cycle.sh M
wt fxb1 main -b b1; sed -i 's/x + 1/x + 2 - 1/' $X/fxb1/src/a.ts; $E git -C $X/fxb1 commit -qam "b1: a"; FX=$X/fxb1 $P/cycle.sh B1
wt fxb2 main -b b2
sed -i 's/x + 1/x + 3 - 2/' $X/fxb2/src/b.ts; $E git -C $X/fxb2 commit -qam "b2: b"; FX=$X/fxb2 $P/cycle.sh B2
$E git -C $FX merge -q --squash b1; $E git -C $FX commit -qm "squash b1"
$E git -C $FX merge -q --squash b2; $E git -C $FX commit -qm "squash b2"
echo "S tree $($E git -C $FX rev-parse HEAD^{tree}); b1 tree $($E git -C $FX rev-parse b1^{tree})"
wt fxn HEAD --detach
FX=$X/fxn $P/cycle.sh N
sed -i 's/x + 1/x + 4 - 3/' $FX/src/c.ts; $E git -C $FX commit -qam "c"
wt fxp1 HEAD --detach; wt fxp2 HEAD --detach
FX=$X/fxp1 $P/cycle.sh P1 > $X/tmp/p1.out 2>&1 & FX=$X/fxp2 $P/cycle.sh P2 > $X/tmp/p2.out 2>&1 & wait
cat $X/tmp/p1.out $X/tmp/p2.out
