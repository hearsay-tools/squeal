#!/usr/bin/env bash
# Throwaway probe for 016-18. Runs model.probe.ts at one commit in a scratch
# worktree of a scratch clone under /tmp/ms18, with HOME, XDG_* and TMPDIR there.
# Usage: run.sh <commit> <label> [VAR=value ...]   (SEEDS, LEN, INV, KIND, STOP, SHRINK)
# Needs /tmp/ms18/repo (git clone --no-checkout of this repository) and NODE_MODULES
# (a node_modules of the same lockfile; symlinked, nothing installed).
set -euo pipefail
commit=$1 label=$2; shift 2
here=$(cd "$(dirname "$0")" && pwd)
base=/tmp/ms18
tree=$base/trees/$label
mkdir -p "$base/home" "$base/run" "$base/config" "$base/tmp" "$base/out" "$base/trees"
if [ ! -d "$tree" ]; then
  git -C "$base/repo" worktree add -q --detach "$tree" "$commit"
  ln -s "${NODE_MODULES:?}" "$tree/node_modules"
fi
cp "$here/model.probe.ts" "$tree/test/scheduler/model-probe.test.ts"
out=$base/out/$label.json
cd "$tree"
echo "load before: $(cat /proc/loadavg)"
env -i PATH="$PATH" HOME="$base/home" XDG_RUNTIME_DIR="$base/run" XDG_CONFIG_HOME="$base/config" \
  XDG_CACHE_HOME="$base/home/.cache" XDG_DATA_HOME="$base/home/.local/share" TMPDIR="$base/tmp" \
  OUT="$out" "$@" \
  /usr/bin/time -f "wall %e s, user %U s, sys %S s, maxrss %M KB" \
  nice -n 10 node node_modules/vitest/vitest.mjs run test/scheduler/model-probe.test.ts --reporter=dot 2>&1 | grep -E "^seed|^ *seed-trace|wall|Test Files|Error|error|FAIL" | head -400
echo "load after: $(cat /proc/loadavg)"
