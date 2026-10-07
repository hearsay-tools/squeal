#!/usr/bin/env bash
# THROWAWAY probe. Wall time of the 201-file suite on fixtures/big with no recorder, the sync
# recorder, and NODE_V8_COVERAGE, process isolation and isolation none. usage: bench-observe.sh <node> <runs>
NODE=${1:-node}; RUNS=${2:-3}; HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/fixtures/big/packages/core"
ISO=--test-isolation; $NODE -v | grep -q '^v22' && ISO=--experimental-test-isolation
t() { local s=$(date +%s%N); "$@" >/dev/null 2>&1; echo $(( ($(date +%s%N) - s) / 1000000 )); }
for i in $(seq "$RUNS"); do
  for iso in process none; do
    base=$(t $NODE --import ../../scripts/test-git-env.mjs --import tsx --test $ISO=$iso --test-reporter=dot test/unit/*.test.ts)
    rec=$(RECORD_DIR=/tmp/ntmg-bench-rec t $NODE --import ../../scripts/test-git-env.mjs --import tsx --import "$HERE/recorder-sync.mjs" --test $ISO=$iso --test-reporter=dot test/unit/*.test.ts)
    cov=$(NODE_V8_COVERAGE=/tmp/ntmg-bench-cov t $NODE --import ../../scripts/test-git-env.mjs --import tsx --test $ISO=$iso --test-reporter=dot test/unit/*.test.ts)
    rm -rf /tmp/ntmg-bench-rec /tmp/ntmg-bench-cov
    echo "$($NODE -v) run=$i isolation=$iso base=${base}ms recorder=${rec}ms v8cov=${cov}ms load=$(cut -d' ' -f1 /proc/loadavg)"
  done
done
