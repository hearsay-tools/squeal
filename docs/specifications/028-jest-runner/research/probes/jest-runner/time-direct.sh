#!/usr/bin/env bash
# Throwaway probe (spec 028 research). Times one direct Jest CLI run (no Nx).
# Usage: time-direct.sh <repo> <cacheDir> <jest.config> <file>...
# Prints one line: load, wall seconds, max RSS KB, Jest's own summary line.
set -u
repo=$1 cache=$2 cfg=$3; shift 3
cd "$repo"
load=$(cut -d' ' -f1 /proc/loadavg)
out=$( { /usr/bin/time -f 'TIME %e %M' node_modules/.bin/jest --config "$cfg" \
  --cacheDirectory="$cache" --no-coverage --runInBand --ci --silent "$@"; } 2>&1 )
t=$(echo "$out" | grep '^TIME' | tail -1)
s=$(echo "$out" | grep -E '^Tests:' | tail -1)
echo "load=$load $t | $s"
