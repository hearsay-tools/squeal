#!/usr/bin/env bash
# Throwaway probe for 016-34: runs count.probe.ts at <commit> in a scratch
# worktree of a scratch clone under /tmp/bc34, HOME, XDG_* and TMPDIR there,
# node_modules symlinked from NODE_MODULES (nothing installed). Counts only.
# Usage: count.sh <commit> [FILES=6] [SHAPE=tiers|slots]
set -euo pipefail
commit=$1; shift
here=$(cd "$(dirname "$0")" && pwd)
base=/tmp/bc34
tree=$base/tree
mkdir -p "$base/home" "$base/run" "$base/config" "$base/tmp" "$base/out"
[ -d "$base/repo" ] || git clone -q --no-checkout "$(git -C "$here" rev-parse --show-toplevel)" "$base/repo"
if [ ! -d "$tree" ]; then
  git -C "$base/repo" worktree add -q --detach "$tree" "$commit"
  ln -s "${NODE_MODULES:?}" "$tree/node_modules"
fi
cp "$here/count.probe.ts" "$tree/test/scheduler/count-probe.test.ts"
label=$(printf '%s' "$*" | tr ' =' '_-')
cd "$tree"
env -i PATH="$PATH" HOME="$base/home" XDG_RUNTIME_DIR="$base/run" XDG_CONFIG_HOME="$base/config" \
  XDG_CACHE_HOME="$base/home/.cache" TMPDIR="$base/tmp" OUT="$base/out/count-$label.jsonl" "$@" \
  nice -n 10 node node_modules/vitest/vitest.mjs run test/scheduler/count-probe.test.ts --reporter=dot 2>&1 \
  | grep -E '^\{|Test Files|Error|FAIL' | head -40
