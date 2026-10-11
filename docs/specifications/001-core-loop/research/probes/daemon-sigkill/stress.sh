#!/usr/bin/env bash
# Runs guard-vitest.sh on the given cezar test files <parallel> at a time for <rounds>
# rounds, each instance its own group leader, and counts guard hits.
# Usage: stress.sh <cezar checkout> <out dir> <parallel> <rounds> <files...>
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$1 out=$2 par=$3 rounds=$4; shift 4
for r in $(seq 1 "$rounds"); do
  for i in $(seq 1 "$par"); do "$here/guard-vitest.sh" "$root" "$out/r$r-$i" server "$@" & done
  wait
  echo "round $r $(date -u +%T) load $(cut -d' ' -f1 /proc/loadavg)"
done
cat "$out"/r*/guard.ndjson > "$out/hits.ndjson"
echo "hits $(wc -l < "$out/hits.ndjson")"
grep -h -E "Tests  " "$out"/r*/vitest.out | sort | uniq -c
