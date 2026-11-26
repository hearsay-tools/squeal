#!/bin/bash
# Row 021-38: the recount test's longest turn per version, interleaved rounds.
S=${S:?the directory with the v568 and main worktrees}
HEAD=${HEAD:?this worktree}
for round in 1 2 3; do
  for v in v568 main head; do
    d=$S/$v; [ $v = head ] && d=$HEAD
    cd $d
    pre=$(cut -d' ' -f1 /proc/loadavg)
    out=$(PATH=/opt/squeal-e2e/node24/bin:$PATH timeout 300 ./node_modules/.bin/vitest run --silent=false test/code/crap/chain-load.test.ts -t recounts 2>&1)
    echo "$v round $round: load before $pre; $(echo "$out" | grep -oE 'longest turn [0-9]+ ms|load average [0-9.]+' | tr '\n' ' ') $(echo "$out" | grep -oE 'Tests +[^(]*' | head -1)"
  done
done
