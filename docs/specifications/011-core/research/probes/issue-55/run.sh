#!/bin/sh
# Throwaway probe for issue 55. Usage: run.sh <repo-root-of-squeal-source> <otherChecks>...
# Seeds /tmp/issue55-probe-<n> per size over 763 other test files, times
# `squeal why src/target.test.ts` there, and removes the repo. Skips a size
# when the one-minute load is above the CPU count. A file query exits 1
# (found: false, a candidate list), so its exit status is ignored.
set -eu
src=$1; shift
here=$(dirname "$0")
cpus=$(nproc)
squeal --version
for n in "$@"; do
  dir=/tmp/issue55-probe-$n
  rm -rf "$dir"
  node "$here/seed.mjs" "$src/src/core/store/schema.ts" "$dir" "$n" 763 >/dev/null
  load=$(cut -d' ' -f1 /proc/loadavg)
  if [ "$(echo "$load > $cpus" | bc)" = 1 ]; then
    echo "n=$n skipped: load $load > $cpus CPUs"
  else
    t=$( { cd "$dir" && /usr/bin/time -f "real %e s user %U s sys %S s" squeal why src/target.test.ts >/dev/null || true; } 2>&1 | grep real )
    echo "n=$n load=$load $t"
  fi
  rm -rf "$dir"
done
