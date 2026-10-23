#!/bin/sh
# 011-165 to 011-167 check on real data: cezar at 28be188dc against its 21e516ef5 pair, under the
# 011-162 brief's isolation (scratch HOME, XDG_*, TMPDIR, pnpm store under /tmp, --ignore-scripts,
# no daemon, git clone never worktree add). Prints the install log tail and the measure's JSON.
# Run from anywhere: sh cezar-check.sh <path to a cezar clone>. Remove /tmp/p165 afterwards.
set -e
S=/tmp/p165
W=$(cd "$(dirname "$0")/../../../../.." && pwd)
CEZAR=${1:?usage: cezar-check.sh <cezar repository to clone>}
rm -rf "$S"
mkdir -p "$S/home" "$S/tmp" "$S/xdg/runtime" "$S/xdg/config" "$S/xdg/cache" "$S/xdg/data" "$S/xdg/state" "$S/store"
chmod 700 "$S/xdg/runtime"
export HOME="$S/home" TMPDIR="$S/tmp" XDG_RUNTIME_DIR="$S/xdg/runtime" XDG_CONFIG_HOME="$S/xdg/config"
export XDG_CACHE_HOME="$S/xdg/cache" XDG_DATA_HOME="$S/xdg/data" XDG_STATE_HOME="$S/xdg/state"
unset PLUGIN_ROOT PLUGIN_DATA PNPM_HOME
for side in a b; do
  git clone -q "$CEZAR" "$S/cezar-$side"
  git -C "$S/cezar-$side" checkout -q 28be188dc
done
echo "load before installs: $(cut -d' ' -f1-3 /proc/loadavg)"
(cd "$S/cezar-a" && pnpm install --frozen-lockfile --ignore-scripts --store-dir "$S/store" 2>&1 | tail -3)
(cd "$S/cezar-b" && git checkout -q '21e516ef5^' -- pnpm-lock.yaml packages/web/package.json \
  && pnpm install --frozen-lockfile --ignore-scripts --store-dir "$S/store" 2>&1 | tail -3 \
  && git checkout -q HEAD -- pnpm-lock.yaml packages/web/package.json && git -C "$S/cezar-b" status --short | head -3)
echo "pnpm: $(cd "$S/cezar-a" && pnpm --version 2>&1 | tail -1)"
echo "lock.yaml lines apart: $(diff "$S/cezar-a/node_modules/.pnpm/lock.yaml" "$S/cezar-b/node_modules/.pnpm/lock.yaml" | grep -c '^[<>]')"
cd "$W"
echo "== A against B"
"$W/node_modules/.bin/tsx" docs/specifications/011-core/tasks/011-165/measure-real.mts "$S/cezar-a" "$S/cezar-b"
echo "== A against A"
"$W/node_modules/.bin/tsx" docs/specifications/011-core/tasks/011-165/measure-real.mts "$S/cezar-a" "$S/cezar-a"
