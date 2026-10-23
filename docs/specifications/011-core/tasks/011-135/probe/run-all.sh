#!/bin/sh
# Row 011-135 probe driver: measure.sh red on every parity file, warm.mjs on two of them, then
# measure.sh green on one. Results go to ./results/. Usage: S=/tmp/d1-135-XXXX sh run-all.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
out="$here/results"
mkdir -p "$out"
LOAD_MAX=${LOAD_MAX:-16}
export LOAD_MAX
PATTERN='U2 ci and timer open|U3 a human message during a ci wait'
sh "$here/measure.sh" red 1 2 claude codex cursor omp opencode pi once | tee "$out/cli-red.txt"
cd "$REPO" && git checkout -q 6a4db210^ -- packages/cezar/src/workflows/run.ts
for runner in claude codex; do
  while :; do
    read -r load _ </proc/loadavg
    [ "$(echo "$load < $LOAD_MAX" | bc)" = 1 ] && break
    sleep 20
  done
  echo "# warm $runner red; load $load; $(date -u +%FT%TZ)"
  node "$here/warm.mjs" "$REPO" "packages/cezar/src/workflows/waits-$runner-parity.test.ts" "$PATTERN" 2>&1 |
    grep -E '^(whole|focused)'
done | tee "$out/warm-red.txt"
git checkout -q 6a4db210 -- packages/cezar/src/workflows/run.ts
sh "$here/measure.sh" green 1 1 claude | tee "$out/cli-green.txt"
echo "# done $(date -u +%FT%TZ)"
