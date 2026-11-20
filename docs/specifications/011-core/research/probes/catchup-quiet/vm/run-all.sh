#!/bin/bash
# run-all.sh (011-416): the measured arms, one after another, each a fresh
# daemon on the warmed clone, the run-loop group held (an agent mid-turn, as
# 011-400's H0), one edit of packages/contract/src/ci-wait.ts (011-395's broad
# edit). Order A B C C B A, so a drift of the VM over the hour falls on each
# quiet alike. Then two arms where the agent edits again 150 s after the broad
# edit (a test file, one file reached): with 30 s the catch-up has started by
# then and the second edit cancels it; with 120 s it has not.
d=$(cd "$(dirname "$0")" && pwd)
B=packages/contract/src/ci-wait.ts
F="150 packages/contract/src/report-title.test.ts"
for a in "Q120a q120" "Q60a q60" "Q30a q30" "Q30b q30" "Q60b q60" "Q120b q120"; do
  set -- $a; bash "$d/arm.sh" "$1" "$2" - '{}' 1 "$B" 3000 || { echo "arm $1 stopped"; exit 1; }
done
for a in "F30 q30" "F120 q120"; do
  set -- $a; FOLLOW="$F" bash "$d/arm.sh" "$1" "$2" - '{}' 1 "$B" 3000 || { echo "arm $1 stopped"; exit 1; }
done
echo "all done $(date -u +%FT%TZ)"
