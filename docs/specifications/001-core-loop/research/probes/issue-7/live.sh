#!/bin/sh
# Throwaway probe for issue 7. A real daemon on the scratch repository
# validates an edit every 0.5 s while `squeal why <partial name>` runs <n>
# times; prints how many attempts came back "store busy" and their times.
# Usage: live.sh <scratch-dir> <squeal.mjs> <n>
set -u
S=$1; CLI=$2; N=$3
export HOME="$S/home"
cd "$S/repo"
node "$CLI" start > /dev/null
( i=0; while [ $i -lt $((N * 2)) ]; do
    printf 'test("generated %s", () => {});\n' $i >> test/fork.test.mjs; i=$((i + 1)); sleep 0.5
  done ) &
EP=$!
busy=0; ok=0; other=0
i=0; while [ $i -lt "$N" ]; do
  t0=$(date +%s%3N); out=$(node "$CLI" why 'parseApplyCheck counts' 2>&1); code=$?; t1=$(date +%s%3N)
  case "$out" in
    *"store busy"*) busy=$((busy + 1)); echo "busy after $((t1 - t0)) ms (exit $code)";;
    Check:*) ok=$((ok + 1));;
    *) other=$((other + 1)); echo "other (exit $code): $(echo "$out" | head -1)";;
  esac
  i=$((i + 1))
done
wait $EP
git checkout -q test/fork.test.mjs
node "$CLI" stop > /dev/null
echo "attempts=$N ok=$ok busy=$busy other=$other"
