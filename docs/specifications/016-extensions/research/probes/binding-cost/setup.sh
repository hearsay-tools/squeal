#!/usr/bin/env bash
# Throwaway probe for 016-34: ESLint into /tmp/bc34/tools (never into the
# repository), then the scratch project. HOME and the npm cache stay there.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
base=/tmp/bc34
mkdir -p "$base/tools" "$base/home" "$base/run" "$base/config" "$base/tmp" "$base/out"
cd "$base/tools"
[ -f package.json ] || echo '{"name":"bc34-tools","private":true}' > package.json
HOME="$base/home" npm_config_cache="$base/home/.npm" nice -n 10 \
  npm install --no-audit --no-fund eslint@9.39.5 @eslint/js@9.39.5
node "$here/setup.mjs" "$base/tools/work"
