#!/usr/bin/env bash
# Throwaway (row 021-02): does `mutagen sync flush` prove the remote equals the local tree
# when a file changes during the flush? Writes a counter every 20 ms, flushes 5 times.
set -euo pipefail
. "$(dirname "$0")/env.sh"
F=$RE/local/squeal/src/race-probe.txt
touch $RE/race.on
( i=0; while [ -f $RE/race.on ]; do i=$((i+1)); echo $i > $F.tmp; mv $F.tmp $F; sleep 0.02; done ) &
for n in 1 2 3 4 5; do
  sleep 0.5
  before=$(cat $F); mutagen sync flush sq >/dev/null; after=$(cat $F)
  remote=$("$RE/sshwrap/ssh" remote cat /work/squeal/src/race-probe.txt 2>/dev/null || echo missing)
  mutagen sync list sq --template '{{ json . }}' > $RE/list-race-$n.json
  echo "flush $n: local before $before, local after $after, remote $remote"
done
rm -f $RE/race.on; wait; rm -f $F
mutagen sync flush sq >/dev/null
