#!/usr/bin/env bash
# Throwaway probe for research/child-coverage.md (Q4). Not product code.
# Usage: timing.sh <fixture dir from run.sh> <scratch dir for raw files>
# CPU of the children alone (bash `times`), NODE_V8_COVERAGE off and on,
# alternated: each round spawns the tsx child and the plain child N times.
set -euo pipefail
FX=$1
RAW=$2
N=${N:-15}
PAIRS=${PAIRS:-5}
cd "$FX"
round() {
  for _ in $(seq "$N"); do
    node --import tsx bin/run-ts.ts 12 >/dev/null
    node bin/run-plain.mjs 3 >/dev/null
  done
}
cpu() { # children's user+sys seconds, from `times` in a subshell
  ( "$@"; times ) | tail -1 | awk '{ split($1,u,"m"); split($2,s,"m"); sub("s","",u[2]); sub("s","",s[2]); printf "%.2f", u[1]*60+u[2]+s[1]*60+s[2] }'
}
echo "pair load_before off_cpu_s on_cpu_s on_bytes"
for p in $(seq "$PAIRS"); do
  load=$(cut -d' ' -f1 /proc/loadavg)
  off=$(cpu round)
  rm -rf "$RAW"; mkdir -p "$RAW"
  on=$(export NODE_V8_COVERAGE="$RAW"; cpu round)
  bytes=$(du -sb "$RAW" | cut -f1)
  echo "$p $load $off $on $bytes"
done
