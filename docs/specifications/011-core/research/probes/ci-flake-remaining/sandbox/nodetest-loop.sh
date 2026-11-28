#!/usr/bin/env bash
# Throwaway probe, row 011-439. Runs ON a sandbox after patch-nodetest.sh: N runs of
# test/integration/node-test.test.ts, each in out/<tag>-<n>/ with the vitest log and the hook log.
# Usage: nodetest-loop.sh <tag> <n>
set -uo pipefail
TAG=$1; N=$2
export PATH=/home/user/node-v22.19.0-linux-x64/bin:/home/user/.local/bin:$PATH CI=true NO_COLOR=1
cd /home/user/squeal
for i in $(seq 1 $N); do
  d=/home/user/out/$TAG-$i; mkdir -p $d; ln -sfn $d /home/user/out/cur
  pkill -9 -u user -f 'vitest|tsx|cli/index' 2>/dev/null || true
  rm -rf node_modules/.vite/vitest
  s=$(date +%s)
  HOOK_LOG=$d/hooks.log timeout 900 pnpm exec vitest run --project isolated test/integration/node-test.test.ts > $d/vitest.log 2>&1
  echo "$i exit=$? secs=$(( $(date +%s) - s )) load=$(cut -d' ' -f1 /proc/loadavg) silent=$(grep -c 'printed=false' $d/hooks.log 2>/dev/null)" | tee -a /home/user/out/$TAG.summary
done
touch /home/user/out/$TAG.done
