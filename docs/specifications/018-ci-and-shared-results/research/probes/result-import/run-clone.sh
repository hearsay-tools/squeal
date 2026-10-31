#!/bin/sh
# Throwaway (topic result-import): clone the fixture, install offline, run Squeal once, dump keys, stop.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
origin=$1; clone=$2; shift 2
git clone -q "$@" "$origin" "$clone"
cd "$clone"
pnpm install --offline --frozen-lockfile --silent
squeal start >"$clone.start.txt" 2>&1 || true
squeal run --all --wait >"$clone.run.txt" 2>&1 || echo "run exit $?" >>"$clone.run.txt"
squeal status --full >"$clone.status.txt" 2>&1 || true
squeal stop >"$clone.stop.txt" 2>&1 || true
common=$(git rev-parse --path-format=absolute --git-common-dir)
mkdir -p "$clone.store"
cp "$common/squeal/store.sqlite"* "$clone.store/"
node "$here/dump-keys.mjs" "$clone.store/store.sqlite" >"$clone.keys.json"
echo "$clone.keys.json"
