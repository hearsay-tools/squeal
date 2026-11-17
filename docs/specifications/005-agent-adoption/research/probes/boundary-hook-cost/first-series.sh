#!/bin/sh
# Throwaway, row 005-110. The owed first delivery after the listing, one run per process: per
# sample, hide the worktree's states, register a new fake consumer, restore the states (born after
# its mark), then time PostToolBatch twice. DAEMON=fresh writes the copy directly; DAEMON=served
# sends the writes to stub-daemon.ts at <scratch>/stub.sock (start it first).
# Usage: first-series.sh <repo> <subject-root> <worktree-id> <src> <scratch> <samples> <fresh|served>
set -u
repo=$1 root=$2 wt=$3 src=$4 S=$5 n=$6 daemon=$7
here=$(cd "$(dirname "$0")" && pwd); W=$(cd "$here/../../../../../.." && pwd)
one() { env SRC="$src" SESSION="$sid" COMMON="$S/$repo" ROOT="$root" OUT="$S/first-$repo.jsonl" SOCKET="$S/stub.sock" DAEMON="$daemon" "$@" \
  timeout 120 nice "$W/node_modules/.bin/tsx" "$here/boundary.ts" >/dev/null 2>>"$S/first-$repo.err"; }
i=0
while [ "$i" -lt "$n" ]; do
  sid=$(cat /proc/sys/kernel/random/uuid)
  node "$here/first-results.mjs" "$S/$repo/squeal/store.sqlite" "$wt" hide >/dev/null
  one HOOK=register
  node "$here/first-results.mjs" "$S/$repo/squeal/store.sqlite" "$wt" restore >/dev/null
  one HOOK=ptb FIRST=1; one HOOK=ptb FIRST=2
  i=$((i + 1))
done
