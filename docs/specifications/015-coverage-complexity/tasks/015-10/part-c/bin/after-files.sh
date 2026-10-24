#!/bin/sh
# Throwaway probe for 015-10 Part C. Not product code.
#   sh after-files.sh <id> <repo>   rebuilds the session's changed source files (base + diff.patch)
#   under files/after-<id>/ and writes files/list-<id>.txt (base and after paths, counted kinds)
set -eu
W=/tmp/dogfood-015-10/w-4ddd4e37
id=$1; repo=$2
case $repo in
  squeal) G=/home/agent/projects/squeal/.ai/cezar/worktrees/4ddd4e37-a86d-432a-9739-e2292f9332f4; C=d5018817aa3c2f6e09126a8d18cfc59389a810c9;;
  cezar) G=/home/agent/projects/cezar; C=03c905a00c449c7a6257e2d0d3c16383cd267743;;
esac
O=$W/files/after-$id
rm -rf "$O"; mkdir -p "$O"
paths=$(grep '^diff --git' "$W/logs/sessions/$id/diff.patch" | sed 's|^diff --git a/\([^ ]*\) .*|\1|' | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$' | grep -vE '\.(test|spec)\.' || true)
[ -n "$paths" ] && git -C "$G" archive "$C" $paths | tar -x -C "$O"
inc=""; for p in $paths; do inc="$inc --include=$p"; done
(cd "$O" && git apply $inc "$W/logs/sessions/$id/diff.patch" 2>&1 | tail -2) || true
: > "$W/files/list-$id.txt"
for p in $paths; do echo "files/base-$repo/$p" >> "$W/files/list-$id.txt"; echo "files/after-$id/$p" >> "$W/files/list-$id.txt"; done
cat "$W/files/list-$id.txt"
