#!/bin/sh
# Throwaway. One measurement series of step-budget.ts on one store copy.
# Usage: series.sh <repo> <subject-root> <worktree-src> <cand-src> <scratch>
set -u
repo=$1 root=$2 W=$3 C=$4 S=$5
here=$(cd "$(dirname "$0")" && pwd)
out=$S/$repo-series.jsonl
run() { env SRC="$1" COMMON="$S/$repo" ROOT="$root" OUT="$out" MODE="$2" ENSURE="$3" LOCK="$4" RUNS="$5" FULL="${6:-}" \
  timeout 600 nice "$W/node_modules/.bin/tsx" "$here/step-budget.ts" >/dev/null 2>>"$S/$repo-series.err"; }
run "$W" mirror spawn 0 12 1
run "$W" mirror alive 0 12
run "$W" mirror none 0 12
run "$W" session spawn 0 10
run "$C" session spawn 0 10
run "$W" mirror spawn 3600 6
run "$C" session spawn 3600 6
run "$W" mirror none 3600 6
