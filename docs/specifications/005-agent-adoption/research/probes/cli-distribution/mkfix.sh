#!/usr/bin/env bash
# Throwaway (005-05). mkfix.sh <dir> <squeal-cli.mjs>: a committed copy of fixture/ with
# Vitest 5.0.3 copied from $NM (default /tmp/r52/nm/node_modules) and squeal.config.json from init.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); D=$1; CLI=$2
mkdir -p "$D"; cp -r "$HERE/fixture/." "$D/"; cp -r "${NM:-/tmp/r52/nm/node_modules}" "$D/node_modules"
cd "$D"; printf 'node_modules\n' > .gitignore; git init -q
node "$CLI" init --harness codex > /dev/null
git add -A; git -c user.email=p@example.com -c user.name=p commit -qm init
