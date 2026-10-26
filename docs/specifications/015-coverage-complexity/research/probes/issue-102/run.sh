#!/usr/bin/env bash
# Usage: run.sh <vitest-version> [config...]. Isolated HOME, npm cache, SQUEAL_DATA.
set -u
V=$1; shift
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=/tmp/issue-102
export HOME=$ROOT/home npm_config_cache=$ROOT/npmcache SQUEAL_DATA=$ROOT/data
export PROVIDER=$SQUEAL_DATA/versions/0.1.342/dist/coverage/provider.mjs
mkdir -p "$HOME" "$npm_config_cache" "$(dirname "$PROVIDER")"
[ -f "$PROVIDER" ] || cp "$(git -C "$HERE" rev-parse --show-toplevel)/plugins/codex/dist/coverage/provider.mjs" "$PROVIDER"
P=$ROOT/v$V; mkdir -p "$P"
cp "$HERE"/*.js "$HERE"/*.mjs "$P"/
cd "$P"
[ -f package.json ] || echo '{"name":"probe","private":true,"type":"module"}' > package.json
[ -d node_modules/vitest ] || npm install --no-audit --no-fund --silent "vitest@$V" jsdom happy-dom >/dev/null
echo "vitest $(node -p 'require("vitest/package.json").version') vite $(node -p 'require("vite/package.json").version') node $(node -v)"
for c in "${@:-node jsdom happy-dom}"; do for cfg in $c; do
  export REPORTS=$ROOT/reports-$V-$cfg; mkdir -p "$REPORTS"
  echo "=== $cfg"; npx vitest run --config vitest.$cfg.config.mjs 2>&1 | tail -40; echo "exit ${PIPESTATUS[0]}"
done; done
