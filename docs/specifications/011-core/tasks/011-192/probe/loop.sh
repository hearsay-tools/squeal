#!/usr/bin/env bash
# Runs busy-edit.test.ts N times in this worktree, one line per run: start, exit, load before and after.
set -u
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out=${1:?out dir}; n=${2:-20}
mkdir -p "$out"
for i in $(seq 1 "$n"); do
  l0=$(cut -d' ' -f1 /proc/loadavg); t0=$(date -u +%H:%M:%SZ)
  env -u PLUGIN_ROOT -u PLUGIN_DATA PROBE_OUT="$out/beats.jsonl" npx vitest run test/daemon/busy-edit.test.ts > "$out/run-$i.log" 2>&1
  rc=$?
  l1=$(cut -d' ' -f1 /proc/loadavg)
  echo "run $i start $t0 exit $rc load $l0 -> $l1 $(grep -o 'Duration .*' "$out/run-$i.log" | head -1)" | tee -a "$out/runs.txt"
done
