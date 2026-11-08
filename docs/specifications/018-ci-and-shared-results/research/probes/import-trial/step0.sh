#!/bin/sh
# Throwaway: the Step 0 reproduction as run by hand on 2026-11-08 (see ../../import-trial.md).
# Runs two cezar test files under Squeal 0.1.417 in a fresh clone under $TMPDIR. Not a full suite.
set -eu
T=${TMPDIR:?}
SQ="node $T/squeal-0.1.417/plugins/claude-code/dist/cli/squeal.mjs"
[ -d "$T/squeal-0.1.417" ] || git clone -q --depth 1 --branch squeal--v0.1.417 https://github.com/hearsay-tools/squeal.git "$T/squeal-0.1.417"
git clone -q --filter=blob:none https://github.com/hearsay-tools/cezarion.git "$T/cez-step0"
cd "$T/cez-step0"
git checkout -q bed82fdb11bf41eb72dd7c33c151841a260df340
pnpm install --frozen-lockfile >/dev/null
# Set FIX=1 to add the proposed exclude line first.
[ "${FIX:-0}" = 1 ] && printf '%s\n' '/\\*' >> .git/info/exclude
$SQ start
$SQ status --wait 120000 | grep '^Revision'
$SQ run tests packages/cezar/src/artifacts/store.test.ts --wait 180000 | head -1
sleep 5; $SQ status | grep '^Revision'; git status --porcelain
$SQ run tests packages/cezar/src/artifacts/store-windows.test.ts --wait 180000 | head -1
sleep 8; $SQ status | grep '^Revision'; git status --porcelain; git status --porcelain --ignored | grep -v node_modules
$SQ stop
cd "$T" && rm -rf "$T/cez-step0"
