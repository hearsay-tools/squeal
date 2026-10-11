#!/usr/bin/env bash
# Starts one Squeal daemon for <root> through daemon-fg.mjs from the caller's cwd and
# environment, logs its exit (code or signal), the load per CPU every 5 s and each
# finished Vitest/node:test run the store records, and stops it with `squeal stop`
# after <seconds> if it is still alive. Usage: daemon-window.sh <squeal.mjs> <root> <out dir> <seconds>
set -u
here=$(cd "$(dirname "$0")" && pwd)
cli=$1 root=$2 out=$3 secs=$4
mkdir -p "$out"
echo "start $(date -u +%T.%N) cwd=$PWD" > "$out/times.txt"
node "$here/daemon-fg.mjs" "$cli" "$root" > "$out/daemon.txt" 2>&1 &
fg=$!
end=$((SECONDS + secs))
while kill -0 $fg 2>/dev/null && [ $SECONDS -lt $end ]; do
  echo "$(date -u +%T) load/cpu=$(awk -v n=$(nproc) '{printf "%.2f", $1/n}' /proc/loadavg)" >> "$out/load.txt"
  sleep 5
done
if kill -0 $fg 2>/dev/null; then (cd "$root" && node "$cli" stop >> "$out/times.txt" 2>&1); fi
wait $fg
echo "end $(date -u +%T.%N)" >> "$out/times.txt"
