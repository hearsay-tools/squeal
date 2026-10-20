#!/usr/bin/env bash
# Throwaway probe (011-35): golden.mjs over each release, in throwaway worktrees
# under /tmp with HOME and XDG_* there. KEY_FORMAT_VERSION is patched to 0 in
# each checkout, so only a change of the key or record code itself shows.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
BASE=/tmp/kfg-golden
mkdir -p "$BASE/home"
export HOME=$BASE/home XDG_CONFIG_HOME=$BASE/home/.config XDG_CACHE_HOME=$BASE/home/.cache XDG_DATA_HOME=$BASE/home/.local/share XDG_STATE_HOME=$BASE/home/.local/state
for ref in ${REFS:-squeal--v0.1.168 squeal--v0.1.199 squeal--v0.1.215 squeal--v0.1.222 squeal--v0.1.223 squeal--v0.1.224 squeal--v0.1.225 origin/cand/0.1.226}; do
  dir=$BASE/$(echo "$ref" | tr '/' '_')
  [ -d "$dir" ] || git -C "$REPO" worktree add -q --detach "$dir" "$ref"
  sed -i -E 's/KEY_FORMAT_VERSION = [0-9]+;/KEY_FORMAT_VERSION = 0;/' "$dir/src/core/keys/key-format.ts"
  echo "## $ref"
  (cd "$HERE" && nice -n 10 node --no-warnings --experimental-transform-types --import ./register.mjs golden.mjs "$dir") | cut -f1,2
done
