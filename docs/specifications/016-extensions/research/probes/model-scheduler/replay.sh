#!/usr/bin/env bash
# Throwaway probe for 016-18: each pre-fix commit, then its fix on the seeds the pre-fix run tried.
# Usage: NODE_MODULES=... replay.sh > results/log.txt
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
one() { # label pre fix INV KIND
  local label=$1 pre=$2 fix=$3 inv=$4 kind=$5
  echo "== $label pre $pre INV=$inv KIND=$kind SEEDS=1-300"
  "$here/run.sh" "$pre" "$label-pre" SEEDS=1-300 INV="$inv" KIND="$kind" SHRINK=1 | grep -v " ok ("
  local tried; tried=$(node -e "console.log(require('/tmp/ms18/out/$label-pre.json').tried)")
  echo "== $label fix $fix INV=$inv KIND=$kind SEEDS=1-$tried"
  "$here/run.sh" "$fix" "$label-fix" SEEDS="1-$tried" INV="$inv" KIND="$kind" STOP=all | grep -v " ok ("
  cp /tmp/ms18/out/$label-pre.json /tmp/ms18/out/$label-fix.json "$here/results/"
}
one r398 5ecb377a8 69d6328bf A,B,C,D,E vitest
one r397 231ecaeb0 b862d2f2d A,B,C,D,E vitest
one r345 d7344427b 3a8d364e4 C,D,E vitest
one r427 dae700644 bc8ed7742 D,E node
# Second pass (after the E fix): HEAD, every invariant, every failure.
if [ "${HEAD_RUN:-0}" = 1 ]; then
  echo "== head HEAD INV=A,B,C,D,E,F KIND=mixed SEEDS=1-300 STOP=all"
  "$here/run.sh" HEAD head SEEDS=1-300 KIND=mixed STOP=all | grep -v " ok ("
  cp /tmp/ms18/out/head.json "$here/results/"
fi
