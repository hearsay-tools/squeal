#!/usr/bin/env bash
# Runs one Vitest project of a cezar checkout as a process-group leader, as the Squeal
# daemon is, with kill-guard.cjs preloaded into every Node process: a kill aimed at the
# group is logged with its stack to <out>/guard.ndjson and not sent. Keeps the caller's
# cwd and environment. Usage: guard-vitest.sh <cezar checkout> <out dir> <project> [vitest args...]
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$1 out=$2 project=$3; shift 3
mkdir -p "$out"; : > "$out/guard.ndjson"
echo "start $(date -u +%T.%N) cwd=$PWD" > "$out/times.txt"
SQ180_LOG="$out/guard.ndjson" NODE_OPTIONS="--require $here/kill-guard.cjs ${NODE_OPTIONS:-}" \
  setsid -w "$here/leader.sh" node "$root/node_modules/vitest/vitest.mjs" run --root "$root" \
  --project "$project" "$@" > "$out/vitest.out" 2>&1
echo "exit $? $(date -u +%T.%N)" >> "$out/times.txt"
