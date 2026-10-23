#!/bin/sh
# Row 011-135 probe, step 1: a /tmp clone of cezarion at 6a4db210, the commit of PR 1384 that
# closed cezarion#1269 and added the two assertions (`\n\nStill open: ...`) to the parity cells.
# Usage: S=/tmp/d1-135-XXXX sh setup.sh   (S must not exist yet or be empty)
# Reads the local cezarion clone's objects only; writes nothing outside $S.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
SOURCE=${CEZARION_SOURCE:-/home/agent/projects/cezar}
COMMIT=6a4db210f0157f7afd8e5952823fde6f9494debc
git clone -q --no-checkout "$SOURCE" "$REPO"
cd "$REPO"
git -c advice.detachedHead=false checkout -q "$COMMIT"
git log --oneline -1
echo "node $(node --version); load $(cut -d' ' -f1 /proc/loadavg) on $(nproc) CPUs; $(date -u +%FT%TZ)"
corepack pnpm --version
corepack pnpm install --frozen-lockfile --reporter=silent
echo "installed: vitest $(node -p "require('./node_modules/vitest/package.json').version")"
