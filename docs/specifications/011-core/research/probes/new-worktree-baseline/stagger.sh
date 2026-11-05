#!/bin/sh
# 011-299 fixture (throwaway), after fixture.sh with MS=20000 (each test file sleeps 20 s): a vitest.config.ts change
# re-keys all 8 files; worktree fxs1 starts, and worktree fxs2 at the same commit starts DELAY s later (default 8),
# while fxs1's runs are in flight. Does any file run in both?
set -e
X=${X:-$TMPDIR/nw/x}; P=$(cd "$(dirname "$0")" && pwd); SQ=${SQ:?squeal checkout}; export X SQ
E="$P/env.sh"; FX=$X/fx
printf '// re-key %s\n' "$(date +%s)" >> $FX/vitest.config.ts; $E git -C $FX commit -qam "config"
for w in fxs1 fxs2; do $E git -C $FX worktree add -q --detach $X/$w HEAD; ln -s "$(readlink $FX/node_modules)" $X/$w/node_modules; done
FX=$X/fxs1 $P/cycle.sh S1 > $X/tmp/s1.out 2>&1 & sleep ${DELAY:-8}; FX=$X/fxs2 $P/cycle.sh S2 > $X/tmp/s2.out 2>&1 & wait
cat $X/tmp/s1.out $X/tmp/s2.out
