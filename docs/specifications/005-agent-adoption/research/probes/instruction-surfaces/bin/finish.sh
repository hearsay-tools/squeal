#!/usr/bin/env bash
# Throwaway: after a session, the ground truth (`npx vitest run` in the fixture),
# then stop its daemon. The agent never sees this run.
source "$(dirname "$0")/env.sh"
L=$1; D=$R/runs/$L; O=$R/logs/$L; cd "$D"
npx vitest run > $O.truth.txt 2>&1; echo "exit $?" >> $O.truth.txt
git status --short > $O.diff.txt; git diff >> $O.diff.txt
[ -f squeal.config.json ] && $SQ stop "$D" > /dev/null 2>&1
grep -E "Tests |exit" $O.truth.txt
