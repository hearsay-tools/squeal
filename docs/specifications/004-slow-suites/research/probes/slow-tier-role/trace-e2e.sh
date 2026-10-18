#!/bin/sh
# Throwaway. Runs each test/e2e spec of a scratch Squeal clone under `strace -f`, three at a
# time, at nice 10, so trace-map.mjs can say which plugin files each spec opened.
# Usage (cwd = the clone, scratch HOME/XDG exported): trace-e2e.sh <trace dir>
out=$1
ls test/e2e/*.test.ts | xargs -P 3 -I{} sh -c '
  n=$(basename {} .test.ts)
  start=$(date +%s)
  nice -n 10 strace -f -qq -e trace=openat,execve -e status=successful -o "'"$out"'/$n.txt" \
    npx vitest run {} > "'"$out"'/$n.log" 2>&1
  echo "$n exit=$? $(( $(date +%s) - start ))s load=$(cut -d" " -f1 /proc/loadavg)"
'
