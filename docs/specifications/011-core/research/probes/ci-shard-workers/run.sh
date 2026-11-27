#!/usr/bin/env bash
# Throwaway probe, row 011-435. Runs ON a boat.dev sandbox after setup.sh.
# Runs Node 22 shard 1/6 exactly as CI's Test step does (`node scripts/ci-shard.mjs --shard 1/6
# $SHARD_ARGS`, SHARD_ARGS copied from ci.yml), once per arm given, in order:
#   D = Vitest's default workers (availableParallelism - 1 = 3 on 4 vCPUs)
#   2 = VITEST_MAX_WORKERS=2, which Vitest 5.0.3 reads into maxWorkers
#       (node_modules/vitest/dist/chunks/index.DpLw24bj.js:14592). Flawed: the variable reaches
#       every Vitest the tests start on fixtures, and Squeal's own CLI, so 9 tests in
#       width.test.ts and code-gate-children.test.ts fail by design. Kept for the first runs only.
#   F = --maxWorkers=2 on the Vitest command line: this run's copy of scripts/ci-shard.mjs gets
#       the flag in its `vitest run` spawn (sed below); the next run's checkout restores it.
#   W = a warm-up run with default workers that fills the e2e install cache; not counted.
# Before each run it returns the machine to a fresh CI job's state: no Vitest results cache
# (else failed files run first), /tmp emptied except the e2e install cache CI restores, no
# stray processes, a clean tree. A sampler records, every 5 s: time, load (1, 5, 15 min), the shard's
# live Vitest fork workers, and MemAvailable in MiB.
# Usage: run.sh <out dir> <arm>...
set -uo pipefail
OUT=$1; shift
export PATH=/home/user/node-v22.19.0-linux-x64/bin:/home/user/.local/bin:$PATH
export CI=true GITHUB_ACTIONS=true NO_COLOR=1
cd /home/user/squeal
SHARD_ARGS=$(sed -n '/SHARD_ARGS: >-/,/^$/p' .github/workflows/ci.yml | grep -- '--' | tr -s ' \n' ' ')
mkdir -p "$OUT"
# The shard's own Vitest fork workers: forks.js processes below ci-shard.mjs, not descending into
# them, so the Vitest runs that test fixtures start inside a worker are not counted.
workers_of() {
  local c
  for c in $(pgrep -P "$1"); do
    if grep -q 'vitest/dist/workers/forks.js' "/proc/$c/cmdline" 2>/dev/null; then echo "$c"
    elif [ "$2" -lt 4 ]; then workers_of "$c" $(($2 + 1)); fi
  done
}
n=0
for arm in "$@"; do
  n=$((n + 1))
  dir="$OUT/$(printf %02d $n)-$arm"
  mkdir -p "$dir"
  pkill -9 -u user -f 'squeal|vitest|tsx' 2>/dev/null || true
  find /tmp -mindepth 1 -maxdepth 1 ! -name squeal-e2e-cache -exec rm -rf {} + 2>/dev/null || true
  rm -rf node_modules/.vite/vitest
  git checkout -q -- . && git clean -fdq
  workers=(); [ "$arm" = 2 ] && workers=(VITEST_MAX_WORKERS=2)
  if [ "$arm" = F ]; then
    sed -i 's/\["exec", "vitest", "run", \.\.\.shard\.files\]/["exec", "vitest", "run", "--maxWorkers=2", ...shard.files]/' scripts/ci-shard.mjs
    grep -q '"--maxWorkers=2", ...shard.files' scripts/ci-shard.mjs || { echo "patch failed" > "$dir/error"; continue; }
  fi
  start=$(date +%s.%N)
  env "${workers[@]}" timeout 3600 node scripts/ci-shard.mjs --shard 1/6 $SHARD_ARGS > "$dir/vitest.log" 2>&1 &
  top=$!
  ( while :; do
      echo "$(date +%s) $(cut -d' ' -f1-3 /proc/loadavg) $(workers_of $top 0 | wc -l) $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"
      sleep 5
    done > "$dir/samples.txt" ) &
  sampler=$!
  wait $top
  code=$?
  end=$(date +%s.%N)
  kill $sampler
  strays=$(pgrep -u user -fc 'squeal|vitest|tsx')
  dirty=$(git status --porcelain | wc -l)
  echo "{\"arm\":\"$arm\",\"order\":$n,\"start\":$start,\"end\":$end,\"exit\":$code,\"strays\":$strays,\"dirtyFiles\":$dirty}" > "$dir/meta.json"
done
touch "$OUT/done"
