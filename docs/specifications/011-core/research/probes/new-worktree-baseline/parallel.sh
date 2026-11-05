#!/bin/sh
# 011-299 fixture (throwaway), after scenario.sh: a change to vitest.config.ts re-keys all 8 files (environment);
# two new worktrees at that commit start at the same moment. Does any file run in both?
set -e
X=${X:-$TMPDIR/nw/x}; P=$(cd "$(dirname "$0")" && pwd); SQ=${SQ:?squeal checkout}; export X SQ
E="$P/env.sh"; FX=$X/fx
printf '// re-key\n' >> $FX/vitest.config.ts; $E git -C $FX commit -qam "config"
for w in fxq1 fxq2; do $E git -C $FX worktree add -q --detach $X/$w HEAD; ln -s "$(readlink $FX/node_modules)" $X/$w/node_modules; done
FX=$X/fxq1 $P/cycle.sh Q1 > $X/tmp/q1.out 2>&1 & FX=$X/fxq2 $P/cycle.sh Q2 > $X/tmp/q2.out 2>&1 & wait
cat $X/tmp/q1.out $X/tmp/q2.out
