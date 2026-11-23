#!/bin/sh
# Throwaway (026 boat-sandboxes). Runs on the sandbox in ~/squeal, fed on ssh's input:
#   boat ssh <id> -- sh -s <label> capacity|git < run-tests.sh
# capacity: the first 10 files of test/capacity (021 boat-trial set A, file locks and syncs).
# unit: the ten files of 021 boat-trial set B (~/unit-files.txt, copied from its probes).
# git: three files that failed in 021 boat-trial D2 for lack of .git.
L=${1:-run}; SET=${2:-capacity}
cd "$HOME/squeal"
case $SET in
  capacity) FILES=$(ls test/capacity/*.test.ts | head -10) ;;
  unit) FILES=$(cat "$HOME/unit-files.txt") ;;
  git) FILES="test/evals/fake-daemon.test.ts test/policy/repository-inputs.test.ts test/keys/key-format.test.ts" ;;
esac
s=$(date +%s%N)
out=$(NO_COLOR=1 node_modules/.bin/vitest run $FILES --reporter=dot 2>&1)
rc=$?
e=$(date +%s%N)
sum=$(printf '%s\n' "$out" | grep -E "Test Files|Tests  |Duration" | tr -s ' ' | tr '\n' ';')
echo "$L $SET: exit $rc wall $(( (e - s) / 1000000 )) ms; $sum"
[ $rc -eq 0 ] || printf '%s\n' "$out" | grep -E "FAIL|Error" | head -8
echo "$L load: $(cat /proc/loadavg)"
