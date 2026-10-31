#!/bin/sh
# Throwaway (topic result-import): clone + install, apply one change (a shell snippet), then run Squeal and dump keys.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
origin=$1; clone=$2; change=$3
git clone -q "$origin" "$clone"
cd "$clone"
pnpm install --offline --frozen-lockfile --silent
sh -c "$change"
squeal start >"$clone.start.txt" 2>&1 || true
squeal run --all --wait >"$clone.run.txt" 2>&1 || echo "run exit $?" >>"$clone.run.txt"
squeal status --full >"$clone.status.txt" 2>&1 || true
squeal stop >"$clone.stop.txt" 2>&1 || true
mkdir -p "$clone.store"; cp .git/squeal/store.sqlite* "$clone.store/"
node "$here/dump-keys.mjs" "$clone.store/store.sqlite" >"$clone.keys.json"
