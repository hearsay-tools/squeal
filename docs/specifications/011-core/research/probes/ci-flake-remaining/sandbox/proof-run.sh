#!/usr/bin/env bash
# Throwaway probe, row 011-440. Runs ON a boat.dev sandbox after setup.sh.
# Runs the five proof files named by flake-0.1.597-storage, once, with CI=true, and keeps the full log.
# Usage: proof-run.sh <out dir> [extra vitest args...]
set -uo pipefail
OUT=$1; shift
export PATH=/home/user/node-v22.19.0-linux-x64/bin:/home/user/.local/bin:$PATH
export CI=true GITHUB_ACTIONS=true NO_COLOR=1
cd /home/user/squeal
mkdir -p "$OUT"
pkill -9 -u user -f 'squeal|vitest|tsx' 2>/dev/null || true
rm -rf node_modules/.vite/vitest
start=$(date +%s)
( while :; do echo "$(date +%s) $(cut -d' ' -f1-3 /proc/loadavg)"; sleep 5; done > "$OUT/samples.txt" ) &
s=$!
timeout 1800 pnpm exec vitest run --project isolated "$@" \
  test/cli/proof-copy.test.ts test/cli/proof.test.ts test/cli/proof-green-daemon.test.ts \
  test/cli/proof-kept-key.test.ts test/cli/proof-not-kept.test.ts > "$OUT/vitest.log" 2>&1
code=$?
kill $s
echo "{\"start\":$start,\"end\":$(date +%s),\"exit\":$code}" > "$OUT/meta.json"
touch "$OUT/done"
