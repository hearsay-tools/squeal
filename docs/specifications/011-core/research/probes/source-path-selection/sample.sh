#!/bin/sh
# Throwaway. Samples what `squeal status <path>` selects in this worktree, read-only,
# one CLI call per sample (one store read for all paths). Usage: sample.sh <samples> <interval-s>
# Prints: time, revision, per path how many test files it selects, and the start-* files among them.
n=${1:-10}; gap=${2:-30}
here=$(cd "$(dirname "$0")" && pwd)
# Paths are relative to the worktree root, so read from there.
cd "$(git -C "$here" rev-parse --show-toplevel)" || exit 1
i=0
while [ "$i" -lt "$n" ]; do
  env -u PLUGIN_ROOT -u PLUGIN_DATA timeout 60 squeal status --json \
    src/cli/start.ts src/cli/start-ready.ts test/daemon/start-helpers.ts src/core/daemon/ensure.ts 2>/dev/null \
    | node "$here/summarize.mjs"
  i=$((i + 1))
  [ "$i" -lt "$n" ] && sleep "$gap"
done
