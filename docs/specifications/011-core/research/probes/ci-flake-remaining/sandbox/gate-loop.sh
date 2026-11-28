#!/usr/bin/env bash
# Throwaway probe, row 011-438. Runs ON a sandbox after patch-gate.sh: N runs of pi-events.test.ts's
# "blocked once" cases (print and rpc), each in out/<tag>-<n>/ (linked as out/cur) with the vitest log
# and the gate log. Usage: gate-loop.sh <tag> <n>
set -uo pipefail
TAG=$1; N=$2
export PATH=/home/user/node-v22.19.0-linux-x64/bin:/home/user/.local/bin:$PATH CI=true NO_COLOR=1
cd /home/user/squeal
for i in $(seq 1 $N); do
  d=/home/user/out/$TAG-$i; mkdir -p $d; ln -sfn $d /home/user/out/cur
  pkill -9 -u user -f 'vitest|tsx|cli/index' 2>/dev/null || true
  rm -rf node_modules/.vite/vitest
  s=$(date +%s)
  timeout 600 pnpm exec vitest run --project isolated test/integration/pi-events.test.ts -t "blocked once" > $d/vitest.log 2>&1
  echo "$i exit=$? secs=$(( $(date +%s) - s )) load=$(cut -d' ' -f1 /proc/loadavg) gates: $(tr '\n' ';' < $d/gate.log 2>/dev/null)" | tee -a /home/user/out/$TAG.summary
done
touch /home/user/out/$TAG.done
