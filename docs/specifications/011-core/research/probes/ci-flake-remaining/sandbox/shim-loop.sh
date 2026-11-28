#!/usr/bin/env bash
# Throwaway probe, row 011-436. Runs ON a sandbox after patch-shim.sh: N runs of
# test/integration/optimizer-start.test.ts, each in out/<tag>-<n>/ with the vitest log, the shim log, and
# (when fatrace is installed) every write to a file named mod.js with the writing pid and command.
# Usage: shim-loop.sh <tag> <n>
set -uo pipefail
TAG=$1; N=$2
export PATH=/home/user/node-v22.19.0-linux-x64/bin:$PATH CI=true NO_COLOR=1
cd /home/user/squeal
for i in $(seq 1 $N); do
  d=/home/user/out/$TAG-$i; mkdir -p $d
  pkill -9 -u user -f 'squeal|vitest|tsx' 2>/dev/null || true
  rm -rf node_modules/.vite/vitest test/fixtures/vitest/.tmp
  fp=
  if command -v fatrace >/dev/null; then
    sudo sh -c "fatrace -t -f W > $d/fatrace.raw 2>&1" & fp=$!
    sleep 1
  fi
  s=$(date +%s)
  SHIM_LOG=$d/shim.log timeout 600 pnpm exec vitest run --project isolated test/integration/optimizer-start.test.ts > $d/vitest.log 2>&1
  code=$?
  [ -n "$fp" ] && { sudo pkill fatrace; sleep 1; grep 'mod.js' $d/fatrace.raw > $d/fatrace.txt; rm -f $d/fatrace.raw; }
  echo "$i exit=$code secs=$(( $(date +%s) - s )) load=$(cut -d' ' -f1 /proc/loadavg)" | tee -a /home/user/out/$TAG.summary
done
touch /home/user/out/$TAG.done
