#!/bin/sh
# 011-82: every probe over both stores, read-only, into results/. Per-run rows
# go to $OUT (default /tmp/p82), outside the repository. Each line of a
# results file is preceded by the one-minute load when that probe started.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-/tmp/p82}
mkdir -p "$OUT" "$here/results"
node_() { node --disable-warning=ExperimentalWarning "$@"; }
for s in squeal cezar; do
  store=/home/agent/projects/$s/.git/squeal/store.sqlite
  runs=/home/agent/projects/$s/.git/squeal/runs
  r="$here/results/$s.txt"
  : > "$r"
  for step in tiers order gaps reversed withheld endorder1 endorder0; do
    echo "== $step, $(date -u +%FT%TZ), load $(cut -d' ' -f1 /proc/loadavg) on $(nproc) CPUs" >> "$r"
    case $step in
      tiers) node_ "$here/tiers.mjs" "$store" "$runs" 24 "$OUT/$s-24h.json" >> "$r" ;;
      order) node_ "$here/order.mjs" "$store" "$runs" 24 "$OUT/$s-24h.json" "$OUT/$s-order.json" >> "$r" ;;
      gaps) node_ "$here/gaps.mjs" "$store" "$OUT/$s-24h.json" "$OUT/$s-gaps.json" >> "$r" ;;
      reversed) node_ "$here/reversed.mjs" "$store" "$runs" "$OUT/$s-24h.json" >> "$r" ;;
      withheld) node_ "$here/withheld.mjs" "$runs" 24 >> "$r" ;;
      endorder1) node_ "$here/endorder.mjs" "$store" "$runs" "$OUT/$s-24h.json" 1 >> "$r" ;;
      endorder0) node_ "$here/endorder.mjs" "$store" "$runs" "$OUT/$s-24h.json" 0 >> "$r" ;;
    esac
  done
done
node_ "$here/burst.mjs" "$here/results/716a6766.txt" > "$here/results/716a6766-burst.txt"
