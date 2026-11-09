#!/usr/bin/env bash
# throwaway (row 018-22): which command forms reach a `vitest` shim placed first on PATH?
# Builds a fixture with a fake node_modules/.bin/vitest (no install, no network) and an
# isolated HOME, then runs each form. Prints SHIM or LOCAL for each.
set -u
W=${1:?scratch dir}; rm -rf "$W"; mkdir -p "$W/fx/node_modules/.bin" "$W/shim" "$W/home"
cat > "$W/fx/node_modules/.bin/vitest" <<'X'
#!/bin/sh
echo "LOCAL vitest $*"
X
cat > "$W/shim/vitest" <<'X'
#!/bin/sh
echo "SHIM vitest $*"
X
chmod +x "$W/fx/node_modules/.bin/vitest" "$W/shim/vitest"
cat > "$W/fx/package.json" <<'X'
{"name":"fx","private":true,"scripts":{"test":"vitest run","test:unit":"vitest run test/unit"}}
X
cd "$W/fx"
export HOME="$W/home" PATH="$W/shim:$PATH" npm_config_offline=true npm_config_update_notifier=false
for form in "vitest run" "npx vitest run" "npm exec vitest run" "pnpm exec vitest run" "pnpm vitest run" "npm test" "npm run test:unit" "pnpm test" "pnpm run test:unit" "./node_modules/.bin/vitest run" "node_modules/.bin/vitest run"; do
  printf '%-34s -> %s\n' "$form" "$(timeout 30 bash -c "$form" 2>&1 | grep -oE '^(SHIM|LOCAL) vitest' | head -1)"
done
