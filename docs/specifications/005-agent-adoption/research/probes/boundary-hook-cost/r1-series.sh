#!/bin/sh
# Throwaway, row 005-110. R1 of 011-385 approximated: after the listing (states restored, born after
# the consumer's mark), the consumer registers again with main's registration (005-106 seed: rows not
# `pass`, and a new mark) instead of the owed delivery; then two ordinary PostToolBatch runs.
# Usage: r1-series.sh <repo> <subject-root> <worktree-id> <src> <scratch> <samples> <fresh|served>
set -u
repo=$1 root=$2 wt=$3 src=$4 S=$5 n=$6 daemon=$7
here=$(cd "$(dirname "$0")" && pwd); W=$(cd "$here/../../../../../.." && pwd)
one() { env SRC="$src" SESSION="$sid" COMMON="$S/$repo" ROOT="$root" OUT="$S/r1-$repo.jsonl" SOCKET="$S/stub.sock" DAEMON="$daemon" "$@" \
  timeout 120 nice "$W/node_modules/.bin/tsx" "$here/boundary.ts" >/dev/null 2>>"$S/r1-$repo.err"; }
i=0
while [ "$i" -lt "$n" ]; do
  sid=$(cat /proc/sys/kernel/random/uuid)
  node "$here/first-results.mjs" "$S/$repo/squeal/store.sqlite" "$wt" hide >/dev/null
  one HOOK=register; sleep 6
  node "$here/first-results.mjs" "$S/$repo/squeal/store.sqlite" "$wt" restore >/dev/null
  one HOOK=register R1=1; one HOOK=ptb FIRST=1; one HOOK=ptb FIRST=2; sleep 6
  i=$((i + 1))
done
