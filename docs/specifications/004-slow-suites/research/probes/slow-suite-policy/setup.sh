#!/bin/sh
# Throwaway. Makes the two copies every probe here runs against, under one
# scratch directory: SCRATCH=/tmp/r004-01-<random>. Never the originals.
set -eu
SQUEAL_SRC=${SQUEAL_SRC:?worktree of squeal}
CEZAR_SRC=${CEZAR_SRC:-/home/agent/projects/cezar}
SCRATCH=${SCRATCH:-$(mktemp -d /tmp/r004-01-XXXXXX)}
echo "SCRATCH=$SCRATCH"
git clone -q --no-hardlinks "$SQUEAL_SRC" "$SCRATCH/squeal"
cp -a "$SQUEAL_SRC/node_modules" "$SCRATCH/squeal/node_modules"
# The e2e install cache is shared host-wide at /tmp/squeal-e2e-cache; point the copy at its own.
sed -i "s#\"/tmp/squeal-e2e-cache\"#\"$SCRATCH/e2e-cache\"#" "$SCRATCH/squeal/test/e2e/install.ts"
git clone -q --no-hardlinks "$CEZAR_SRC" "$SCRATCH/cezar"
# The original's node_modules lagged its lockfile (@types/node 20 against ^24), so install.
(cd "$SCRATCH/cezar" && npm ci --prefer-offline >"$SCRATCH/cezar-ci.log" 2>&1)
(cd "$SCRATCH/cezar" && npm run build -w @wjarka/cezarion >"$SCRATCH/cezar-build.log" 2>&1)
