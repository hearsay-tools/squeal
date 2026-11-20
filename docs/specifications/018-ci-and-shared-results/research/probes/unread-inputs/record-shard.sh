#!/usr/bin/env bash
# Throwaway probe (row 018-56). Re-records one cezar Vitest shard as its merge-group job runs it,
# keeps the raw evidence (bundle patched with SQUEAL_PROBE_KEEP, README.md), and records the
# checkout's state before and after the command: what a start-and-end hash would see.
# Usage, on a separate VM: record-shard.sh <work-dir> <shard>   (work-dir holds cz/ and sq/)
set -u
work=$1 shard=$2
cd "$work/cz"
out="$work/shard-$shard"
rm -rf "$out" && mkdir -p "$out"
export HOME="$work/home" CI=true VITEST_FILE_DURATION_CAP=1
git update-index -q --really-refresh
git status --porcelain=v2 --untracked-files=all --ignored=matching > "$out/status-before.txt"
git ls-files -s > "$out/index-before.txt"
start=$(date +%s)
SQUEAL_PROBE_KEEP="$out/evidence" node "$work/sq/cli/squeal.mjs" ci record --out "$out/parts" -- \
  npm test -- --shard="$shard/8" --maxWorkers=4 > "$out/command.log" 2>&1
echo "exit $? after $(( $(date +%s) - start )) s" > "$out/exit.txt"
git update-index -q --really-refresh
git status --porcelain=v2 --untracked-files=all --ignored=matching > "$out/status-after.txt"
git ls-files -s > "$out/index-after.txt"
# The cost of hashing every tracked file once, as a start or end hash would.
{ time (git ls-files -z | xargs -0 git hash-object -- > /dev/null); } 2> "$out/hash-all-time.txt"
git ls-files | wc -l > "$out/tracked-count.txt"
