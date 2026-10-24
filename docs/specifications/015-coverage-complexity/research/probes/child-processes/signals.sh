#!/bin/bash
# Throwaway probe (015 R3): does a Node process write its NODE_V8_COVERAGE file
# when a signal ends it? Usage: signals.sh <scratch dir>
D=${1:?scratch dir}; mkdir -p "$D"; cd "$D" || exit 1
echo 'process.on("SIGTERM",()=>process.exit(0)); setInterval(()=>{},1000);' > handled.mjs
echo 'setInterval(()=>{},1000);' > plain.mjs
for c in "plain.mjs TERM" "plain.mjs KILL" "handled.mjs TERM" "plain.mjs INT"; do
  set -- $c; out=$D/raw-$1-$2; rm -rf "$out"
  NODE_V8_COVERAGE=$out node "$1" & pid=$!; sleep 0.5; kill -"$2" $pid; wait $pid 2>/dev/null
  echo "$1 SIG$2: $(ls "$out" 2>/dev/null | wc -l) coverage files"
done
