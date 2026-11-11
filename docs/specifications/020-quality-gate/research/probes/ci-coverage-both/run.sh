#!/bin/sh
# Throwaway. Usage: sh run.sh <squeal-worktree> <vitest-version> [outDir]
# Installs ./fixture with vitest and @vitest/coverage-v8 at <vitest-version> in a
# mktemp directory under /tmp (HOME and TMPDIR inside it), then runs probe.mjs in
# each mode. Refuses to start while the one-minute load is above 24; prints the
# load at start and end. Writes nothing in the repository but <outDir>.
set -eu
TREE=$(cd "$1" && pwd); V=$2; HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(mkdir -p "${3:-$HERE/out/$V}" && cd "${3:-$HERE/out/$V}" && pwd)
load() { cut -d' ' -f1 /proc/loadavg; }
L=$(load); echo "load at start: $L"
if [ "$(echo "$L > 24" | bc)" = 1 ]; then echo "load above 24: not run"; exit 3; fi
W=$(mktemp -d /tmp/r189-XXXXXX); export HOME=$W/home TMPDIR=$W/tmp; mkdir -p "$HOME" "$TMPDIR"
cp -r "$HERE/fixture" "$W/p"; cp "$HERE/probe.mjs" "$W/p/"
cd "$W/p"
printf '{"name":"r189","private":true,"type":"module","devDependencies":{"vitest":"%s","@vitest/coverage-v8":"%s"}}\n' "$V" "$V" > package.json
pnpm install --ignore-workspace --silent > "$OUT/install.log" 2>&1
export SQUEAL_COVERAGE_CJS=$TREE/src/runners/vitest/ci-runtime/coverage.cjs
export SQUEAL_PROVIDER=$TREE/plugins/claude-code/dist/coverage/provider.mjs
export SQUEAL_MAPPER=$TREE/plugins/claude-code/dist/cli/coverage-map.mjs
run() { # out mode, env set by caller
  node probe.mjs "$2" "$OUT/$1" > "$OUT/$1-$2.log" 2>&1 || true
  tail -1 "$OUT/$1-$2.log"
}
for m in plain tee tee-nocopy squeal; do run threshold "$m"; done
for m in plain tee; do THRESHOLD=0 run nothreshold "$m"; done
for m in plain tee squeal; do NAME_FILTER='twice$|adds' run named "$m"; done
echo "dir: $W"; echo "load at end: $(load)"
