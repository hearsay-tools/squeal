#!/usr/bin/env bash
# Throwaway probe, row 011-440. Runs ON the sandbox after patch-why.sh (and patch-stores.sh): N runs
# of the patched proof files, each with its own folder out/<tag>-<n>/ (also linked as out/cur), keeping
# the vitest log, the child notes (forward.log), the store-open log and the JSON reports.
# Usage: why-loop.sh <tag> <n> [files...]
set -uo pipefail
TAG=$1; N=$2; shift 2
FILES=("$@"); [ ${#FILES[@]} -eq 0 ] && FILES=(test/cli/proof-kept-key.test.ts test/cli/proof-not-kept.test.ts)
export PATH=/home/user/node-v22.19.0-linux-x64/bin:$PATH CI=true NO_COLOR=1
cd /home/user/squeal
for i in $(seq 1 $N); do
  d=/home/user/out/$TAG-$i; mkdir -p $d; ln -sfn $d /home/user/out/cur
  pkill -9 -u user -f 'squeal|vitest|tsx' 2>/dev/null || true
  rm -rf node_modules/.vite/vitest
  [ -n "${COLD:-}" ] && { sync; sudo sh -c "echo 3 > /proc/sys/vm/drop_caches"; }
  s=$(date +%s)
  WHY_DIR=$d timeout 600 pnpm exec vitest run --project isolated "${FILES[@]}" > $d/vitest.log 2>&1
  echo "$i exit=$? secs=$(( $(date +%s) - s )) load=$(cut -d' ' -f1 /proc/loadavg)" | tee -a /home/user/out/$TAG.summary
done
touch /home/user/out/$TAG.done
