#!/usr/bin/env bash
# Usage: variants.sh <vitest-version>, after run.sh installed it. jsdom, one line per variant.
set -u
V=$1; HERE=$(cd "$(dirname "$0")" && pwd); ROOT=/tmp/issue-102
export HOME=$ROOT/home npm_config_cache=$ROOT/npmcache SQUEAL_DATA=$ROOT/data
export PROVIDER=$SQUEAL_DATA/versions/0.1.342/dist/coverage/provider.mjs
cp "$HERE"/*.mjs "$HERE"/*.js "$ROOT/v$V/"; cd "$ROOT/v$V"
for VARIANT in ${VARIANTS:-outside inside-root file-url fs-allow fs-strict-off}; do
  export VARIANT REPORTS=$ROOT/reports-$V-$VARIANT; mkdir -p "$REPORTS"
  out=$(npx vitest run --config vitest.variant.config.mjs 2>&1); code=$?
  echo "$VARIANT exit=$code $(grep -E 'Caused by|Test Files' <<<"$out" | tr '\n' ' ')"
done
