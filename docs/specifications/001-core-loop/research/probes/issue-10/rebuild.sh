#!/bin/sh
# Throwaway (issue 10 research). Stands in for the reporter's `npm run build`:
# rewrites every file of packages/server/dist with the same bytes, $2 times,
# 1 s apart, so a run in flight sees paths written that end as they were.
set -eu
cd "$1/packages/server/dist"
i=0
while [ $i -lt "${2:-10}" ]; do
  for f in *.js; do cp "$f" "$f.tmp" && mv "$f.tmp" "$f"; done
  i=$((i + 1)); sleep 1
done
