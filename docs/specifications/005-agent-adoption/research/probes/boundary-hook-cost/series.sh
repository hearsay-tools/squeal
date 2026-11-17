#!/bin/sh
# Throwaway, row 005-110. One untraced run per process, as a real hook runs; per round and per
# version: PostToolBatch with news twice (one state flipped to a failure and back, so other consumers
# see no net change), then a silent PostToolBatch, then a silent Stop. Each version has its own
# consumer, registered by that version first. Usage:
#   series.sh <repo> <subject-root> <main-src> <0.1.546-src> <scratch> <rounds> [extra env...]
set -u
repo=$1 root=$2 M=$3 O=$4 S=$5 n=$6; shift 6
here=$(cd "$(dirname "$0")" && pwd)
out=$S/series-$repo.jsonl
one() { src1=$1 sid1=$2; shift 2; env SRC="$src1" SESSION="$sid1" COMMON="$S/$repo" ROOT="$root" OUT="$out" DAEMON=fresh "$@" \
  timeout 120 nice "$M/node_modules/.bin/tsx" "$here/boundary.ts" >/dev/null 2>>"$S/series-$repo.err"; }
sm=$(cat /proc/sys/kernel/random/uuid); so=$(cat /proc/sys/kernel/random/uuid)
one "$M" "$sm" HOOK=register; one "$O" "$so" HOOK=register
i=0
while [ "$i" -lt "$n" ]; do
  for v in m o; do
    if [ $v = m ]; then src=$M sid=$sm; else src=$O sid=$so; fi
    one "$src" "$sid" HOOK=ptb NEWS=1 "$@"; one "$src" "$sid" HOOK=ptb NEWS=1 "$@"
    one "$src" "$sid" HOOK=ptb "$@"; one "$src" "$sid" HOOK=stop "$@"
  done
  i=$((i + 1))
done
