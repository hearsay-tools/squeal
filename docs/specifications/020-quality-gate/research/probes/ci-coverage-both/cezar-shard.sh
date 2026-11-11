#!/bin/sh
# Throwaway. Usage: sh cezar-shard.sh <squeal-worktree> <rounds> <outDir> [modes]
# A `git clone --shared` of ~/projects/cezar at its HEAD in a mktemp directory
# under /tmp (HOME and TMPDIR inside it), with copies of its node_modules
# directories and `npm run build:server`; REUSE=<that directory> skips the
# clone, the copies and the build. Then <rounds> times, in order, each mode on
# shard 1/4 with 4 workers and the four unit projects, as cezarion's PR shards
# run: `none` (no coverage), `plain` (coverage enabled, V8 only), `tee`
# (coverage enabled, Squeal reads the V8 payloads). Nothing is written in
# ~/projects/cezar. Waits while the one-minute load is above 24; records the
# load before and after each run.
set -eu
TREE=$(cd "$1" && pwd); N=$2; HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(mkdir -p "$3" && cd "$3" && pwd); MODES=${4:-"none plain tee"}
SRC=$HOME/projects/cezar
load() { cut -d' ' -f1 /proc/loadavg; }
if [ -n "${REUSE:-}" ]; then W=$REUSE; else
  W=$(mktemp -d /tmp/r189-cezar-XXXXXX)
  git clone -q --shared "$SRC" "$W/c"
  (cd "$SRC" && find . -name node_modules -prune -not -path './.git/*' -not -path './.ai/*') | while read -r d; do
    mkdir -p "$W/c/$(dirname "$d")"; cp -a "$SRC/$d" "$W/c/$d"
  done
  mkdir -p "$W/home" "$W/tmp"
  (cd "$W/c" && HOME=$W/home TMPDIR=$W/tmp npm run build:server > "$OUT/build.log" 2>&1)
fi
echo "cezar $(git -C "$W/c" log -1 --format='%h %cs') in $W" | tee "$OUT/setup.txt"
export HOME=$W/home TMPDIR=$W/tmp
cp "$HERE/probe.mjs" "$W/c/"; cd "$W/c"
export SQUEAL_COVERAGE_CJS=$TREE/src/runners/vitest/ci-runtime/coverage.cjs
export SQUEAL_PROVIDER=$TREE/plugins/claude-code/dist/coverage/provider.mjs
export SQUEAL_MAPPER=$TREE/plugins/claude-code/dist/cli/coverage-map.mjs
export SHARD=1/4 MAX_WORKERS=4 CI=true PROJECTS=server,contract,api-client,web
i=0
while [ "$i" -lt "$N" ]; do
  for m in $MODES; do
    while [ "$(echo "$(load) > 24" | bc)" = 1 ]; do sleep 30; done
    if [ "$m" = none ]; then C=0; M=plain; else C=1; M=$m; fi
    L=$(load)
    COVERAGE=$C /usr/bin/time -f "$m round=$i wall=%e user=%U sys=%S load_before=$L" \
      node probe.mjs "$M" "$OUT/r$i/$m" > "$OUT/r$i-$m.log" 2> "$OUT/r$i-$m.err" || true
    echo "$(tail -1 "$OUT/r$i-$m.err") load_after=$(load) $(tail -1 "$OUT/r$i-$m.log")" >> "$OUT/timing.txt"
  done
  i=$((i + 1))
done
