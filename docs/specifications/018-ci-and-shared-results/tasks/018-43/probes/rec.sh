#!/bin/sh
# Throwaway (row 018-43): one squawk test file under `squeal ci record` (shard 1/1), then `ci export` of that part.
# usage: rec.sh <base|new> <name> <project> <file>
S=/home/agent/projects/squeal/.ai/cezar/t/37809bc6
WT=/home/agent/projects/squeal/.ai/cezar/worktrees/37809bc6-27de-49d9-8d04-79dd3264b3f6
V=$1; N=$2; P=$3; F=$4
CLI=$S/probe/squeal-ci.mts; [ "$V" = base ] && CLI=$S/probe/squeal-ci-base.mts
OUT=$S/rec/$V-$N
rm -rf "$OUT"; mkdir -p "$OUT"
cd $S/squawk || exit 2
export CI=true HOME=$S/home TMPDIR=$S/tmp
nice -n 10 "$WT/node_modules/.bin/tsx" "$CLI" record --out "$OUT/parts" -- node_modules/.bin/vitest run --project "$P" "$F" > "$OUT/record.log" 2>&1
echo "record exit $?"
"$WT/node_modules/.bin/tsx" "$CLI" export --parts "$OUT/parts" --out "$OUT/results.json.gz" > "$OUT/export.log" 2>&1
echo "export exit $?"
