#!/bin/sh
# Throwaway probe for issue 7. One controlled attempt: a holder takes <mode>
# on the scratch store for <holdMs>; 100 ms after it holds, `squeal why` runs
# once; after the holder released, `squeal why` runs again to tell evidence
# unavailable (it comes back) from evidence deleted (it does not).
# Usage: attempt.sh <scratch-dir> <squeal.mjs> <mode> <holdMs> [check]
set -u
S=$1; CLI=$2; MODE=$3; HOLD=$4; CHECK=${5:-parseApplyCheck counts distinct fork-deleted}
HERE=$(cd "$(dirname "$0")" && pwd)
export HOME="$S/home"
cd "$S/repo"
DB=.git/squeal/store.sqlite
OUT=$(mktemp -d)
node "$HERE/hold.mjs" "$DB" "$MODE" "$HOLD" > "$OUT/hold" 2>&1 &
HP=$!
until grep -q held "$OUT/hold" 2>/dev/null; do sleep 0.02; done
sleep 0.1
t0=$(date +%s%3N)
node "$CLI" why "$CHECK" > "$OUT/out" 2> "$OUT/err"; code=$?
t1=$(date +%s%3N)
wait $HP
echo "mode=$MODE hold=${HOLD}ms why_start=$t0 why_end=$t1 elapsed=$((t1 - t0))ms exit=$code"
cat "$OUT/hold"
echo "--- stdout (first 3 lines)"; head -3 "$OUT/out"
echo "--- stderr"; cat "$OUT/err"
node "$CLI" why "$CHECK" > "$OUT/after" 2>&1; echo "--- after release: exit=$? $(grep -c '^  PASS\|^  FAIL' "$OUT/after") result line(s); $(sed -n 6p "$OUT/after")"
rm -rf "$OUT"
