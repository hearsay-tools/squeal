#!/usr/bin/env bash
# Throwaway probe, row 011-436. Runs ON a sandbox after setup.sh and patch-shim.sh: N runs of the Node 22
# CI shard that holds optimizer-start (5/6 at 0e5223ca8), as CI's Test step runs it, with the shim's call
# log ($SHIM_LOG) and fatrace's writes to any mod.js, per run in out/<tag>-<n>/.
# Usage: shard-shim.sh <tag> <n> <shard>
set -uo pipefail
TAG=$1; N=$2; SHARD=$3
export PATH=/home/user/node-v22.19.0-linux-x64/bin:/home/user/.local/bin:$PATH
export CI=true GITHUB_ACTIONS=true NO_COLOR=1
cd /home/user/squeal
SHARD_ARGS=$(sed -n '/SHARD_ARGS: >-/,/^$/p' .github/workflows/ci.yml | grep -- '--' | tr -s ' \n' ' ')
for i in $(seq 1 $N); do
  d=/home/user/out/$TAG-$i; mkdir -p $d
  pkill -9 -u user -f 'vitest|tsx|cli/index' 2>/dev/null || true
  find /tmp -mindepth 1 -maxdepth 1 -user user ! -name squeal-e2e-cache -exec rm -rf {} + 2>/dev/null || true
  rm -rf node_modules/.vite/vitest test/fixtures/vitest/.tmp
  sudo sh -c "fatrace -t -f W | grep --line-buffered 'mod.js' > $d/fatrace.txt 2>&1" & sleep 1
  s=$(date +%s)
  SHIM_LOG=$d/shim.log timeout 3600 node scripts/ci-shard.mjs --shard $SHARD $SHARD_ARGS > $d/vitest.log 2>&1
  code=$?
  sudo pkill fatrace; sleep 1
  grep -E "optimizer-start|Test Files|Tests  " $d/vitest.log | tail -5 > $d/summary.txt
  echo "$i exit=$code secs=$(( $(date +%s) - s )) load=$(cut -d' ' -f1 /proc/loadavg) $(grep -c 'FAIL ' $d/vitest.log) FAIL lines" | tee -a /home/user/out/$TAG.summary
done
touch /home/user/out/$TAG.done
