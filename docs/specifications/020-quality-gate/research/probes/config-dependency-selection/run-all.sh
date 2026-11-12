#!/bin/sh
# Throwaway (row 020-42). For each edit: fresh fixture copy, apply the edit, run probe.mjs.
# Usage: run-all.sh <worktree> <out-dir>. Run under guard.sh, with HOME and TMPDIR under /tmp/cds.
set -eu
W=$1; OUT=$2; P=$(dirname "$0")
TSX="$W/node_modules/tsx/dist/esm/index.mjs"
for name in baseline $(node "$P/edits.mjs" x --list); do
  R=/tmp/cds/fx-$name
  rm -rf "$R"; cp -a "$P/fixture" "$R"; ln -s "$W/node_modules" "$R/node_modules"
  [ "$name" = baseline ] || node "$P/edits.mjs" "$R" "$name"
  nice -n 10 node --import "$TSX" "$P/probe.mjs" "$R" "$W" > "$OUT/$name.json" 2> "$OUT/$name.err" || echo "$name exit $?" >&2
  echo "$name done" >&2
done
