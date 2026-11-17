#!/bin/sh
# Throwaway. As a real hook runs: one registration per process, untraced, variants interleaved,
# N rounds. Usage: series-fresh.sh <repo> <subject-root> <worktree-src> <cand-src> <scratch> <N>
set -u
repo=$1 root=$2 W=$3 C=$4 S=$5 n=$6
here=$(cd "$(dirname "$0")" && pwd)
out=$S/$repo-fresh.jsonl
one() { env SRC="$1" COMMON="$S/$repo" ROOT="$root" OUT="$out" MODE="$2" ENSURE="$3" LOCK=0 RUNS=1 NOTRACE=1 \
  timeout 120 nice "$W/node_modules/.bin/tsx" "$here/step-budget.ts" >/dev/null 2>>"$S/$repo-fresh.err"; }
i=0
while [ $i -lt "$n" ]; do
  one "$W" mirror spawn; one "$W" mirror alive; one "$W" mirror none; one "$W" session spawn; one "$C" session spawn
  i=$((i + 1))
done
