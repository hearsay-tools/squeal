#!/usr/bin/env bash
# Usage: fixes.sh <vitest-version>, after run.sh installed it.
set -u
V=$1; HERE=$(cd "$(dirname "$0")" && pwd); ROOT=/tmp/issue-102
export HOME=$ROOT/home npm_config_cache=$ROOT/npmcache SQUEAL_DATA=$ROOT/data
export PROVIDER=$SQUEAL_DATA/versions/0.1.342/dist/coverage/provider.mjs
cp "$HERE"/*.mjs "$HERE"/*.js "$ROOT/v$V/"; cd "$ROOT/v$V"
for CONFIG in ${CONFIGS:-vitest.jsdom.config.mjs vitest.projects.config.mjs}; do for FIX in none allow safe; do
  export CONFIG FIX REPORTS=$ROOT/reports-$V-fix; mkdir -p "$REPORTS"
  echo "## $CONFIG $FIX"; node probe-fix.mjs 2>&1 | grep -v '^\s*$' | head -40
done; done
