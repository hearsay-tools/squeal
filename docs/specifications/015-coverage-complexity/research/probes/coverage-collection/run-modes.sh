#!/bin/sh
# Throwaway (015-01): copy the fixture to /tmp per mode and run warm.mjs there.
# Usage: run-modes.sh <node_modules dir> <mode> [config] [runs]
set -e
here=$(cd "$(dirname "$0")" && pwd)
modules=$1; mode=$2; config=${3:--}; runs=${4:-2}
dir=${PROBE_BASE:-/tmp/sq015-fix}/$mode-$(basename "$config")
rm -rf "$dir"; mkdir -p "$dir"
cp -r "$here/fixture" "$dir/root"
ln -s "$modules" "$dir/root/node_modules"
mkdir -p "$dir/root/coverage"; echo developer > "$dir/root/coverage/keep.txt"
cd "$dir/root"
node "$here/warm.mjs" "$modules" . "$mode" "$config" "$runs" || echo "EXIT $?"
echo "AFTER: $(ls "$dir/root" | tr "\n" " ") coverage/: $(ls "$dir/root/coverage" 2>&1 | tr "\n" " ")"
