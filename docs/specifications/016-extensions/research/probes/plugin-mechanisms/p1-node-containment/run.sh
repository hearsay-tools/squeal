#!/bin/sh
# Each in-process run sits under an outer `timeout 3` so a blocked event loop cannot hang the probe.
cd "$(dirname "$0")"
for m in ok throw hang spin pollute; do
  echo "== in-process $m"; timeout 3 node in-process.mjs $m; echo "(exit $?)"
  echo "== worker $m"; timeout 3 node worker.mjs $m; echo "(exit $?)"
  echo "== child $m"; timeout 3 node child.mjs $m; echo "(exit $?)"
done
