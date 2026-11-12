#!/usr/bin/env bash
# Throwaway probe for row 021-30. Makes a scratch under $SCRATCH_ROOT (the task's $TMPDIR):
#   home/ run/ config/ cache/ tmp/   HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, XDG_CACHE_HOME, TMPDIR
#   squeal/                          a shallow `git clone` of this worktree's branch (never a worktree)
#   log/                             what the probes write
# Installs offline from the host's pnpm store, copying files (no hardlinks into the shared
# store), as research 021-27's setup.sh does. Prints the scratch path.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WT=$(cd "$HERE/../../../../.." && pwd)
BRANCH=$(git -C "$WT" rev-parse --abbrev-ref HEAD)
STORE=/home/agent/.local/share/pnpm/store/v11
S=$(mktemp -d "${SCRATCH_ROOT:?}/sa-squeal-XXXXXX")
mkdir -p "$S"/{home,run,config/squeal,cache,tmp,log}
chmod 700 "$S/run"
git clone --quiet --depth 1 --branch "$BRANCH" "file://$WT" "$S/squeal"
(
  cd "$S/squeal"
  export HOME=$S/home XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
  mkdir -p "$S/cache/pnpm" && cp -r /home/agent/.cache/pnpm/v12 "$S/cache/pnpm/" 2>/dev/null || true
  export COREPACK_HOME=/home/agent/.cache/node/corepack
  pnpm install --offline --frozen-lockfile --store-dir "$STORE" --package-import-method copy \
    --config.minimum-release-age=0 --reporter silent >"$S/log/pnpm-install.txt" 2>&1
)
echo "$S"
