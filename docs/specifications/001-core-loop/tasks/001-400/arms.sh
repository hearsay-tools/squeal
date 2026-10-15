#!/bin/bash
# Alternates repro.sh runs between a copy of the commit before the fix and the fix, run by run, so
# both arms see the same host load. Usage: arms.sh <before tree> <after tree> <pairs> <heap MB>.
here=$(dirname "$(realpath "$0")")
for i in $(seq "$3"); do
  for arm in before after; do
    tree=$1; [ $arm = after ] && tree=$2
    echo "$arm $("$here/repro.sh" "$tree" 1 "$4" "/tmp/sq400-$arm-logs" | sed "s/^run 1/pair $i/")"
  done
done
