#!/bin/sh
# 011-150 probe (throwaway): does an edit change what cezar's browser tests run? Builds the e2e
# bundle (`.ai/scripts/build-e2e.sh`: tsc of packages/cezar, vite build of packages/web) in a
# scratch clone, once per edit, and prints one hash per output tree, so two builds compare.
# Each edit is applied to a clean checkout and reverted after its build. `.d.ts` files are left out
# of the hash: tsc 7.0.2 emits server.d.ts in a varying order, and no browser test executes them.
# Usage: build-diff.sh <clone> <label> [<path> <kind>]   kind: comment | literal
# `comment` appends a comment line; `literal` replaces the first single-quoted word literal on a
# line without `import` or `from`
# (the positive control: a change the bundle must carry).
set -eu
C=$1; L=$2; P=${3:-}; K=${4:-}
S=/tmp/di150
cd "$C"
git checkout -q -- .
if [ -n "$P" ]; then
  case "$K" in
    comment) printf '\n// 011-150 probe comment\n' >> "$P" ;;
    literal) perl -0pi -e "s/^((?:(?!\\b(?:import|from)\\b).)*?)'[A-Za-z][A-Za-z ]*'/\\1'011-150 probe'/m" "$P" ;;
  esac
fi
L1=$(cut -d' ' -f1 /proc/loadavg); T0=$(date +%s)
taskset -c 20-23 nice -n 10 $S/env.sh sh .ai/scripts/build-e2e.sh > $S/logs/build-$L.log 2>&1 || { echo "$L build failed, see $S/logs/build-$L.log"; git checkout -q -- .; exit 1; }
T1=$(date +%s)
h() { (cd "$1" && find . -type f ! -name '*.map' ! -name '*.d.ts' ! -name '.cez-e2e-build' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12); }
hm() { (cd "$1" && find . -type f -name '*.map' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12); }
O=.ai/qa/build/cezar
echo "$L server_dist=$(h $O/dist) server_maps=$(hm $O/dist) web_dist=$(h $O/web/dist) web_maps=$(hm $O/web/dist) wall=$((T1 - T0))s load1=$L1 path=${P:--} kind=${K:--}"
git checkout -q -- .
