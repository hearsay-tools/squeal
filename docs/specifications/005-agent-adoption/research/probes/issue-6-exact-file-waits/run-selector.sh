#!/bin/sh
# Issue 6 selector probe: copies this repository at HEAD to a new /tmp
# directory, installs it there, and runs selector.probe.test.ts against that
# copy's src/cli/status-wait-paths.ts. Never touches this checkout's store.
# Usage: run-selector.sh [<existing /tmp copy with node_modules>]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
copy=${1:-}
if [ -z "$copy" ]; then
  work=$(mktemp -d /tmp/squeal-issue6-XXXX)
  copy=$work/src-copy
  mkdir "$copy"
  git -C "$repo" archive HEAD | tar -x -C "$copy"
  (cd "$copy" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null)
fi
mkdir -p "$copy/.tmp"
cp "$here/selector.probe.test.ts" "$copy/test/cli/issue6-selector.probe.test.ts"
echo "commit: $(git -C "$repo" rev-parse HEAD)  version: $(node -p "require('$copy/package.json').version")"
cd "$copy"
TMPDIR=$copy/.tmp npx vitest run test/cli/issue6-selector.probe.test.ts --reporter=dot 2>&1 \
  | grep -E '^ISSUE6|Test Files|Tests '
