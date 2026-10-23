#!/bin/sh
# 011-162 probe, not product code (brief question 4). One small pnpm workspace installed under each
# layout setting; prints where pnpm writes its installed lockfile and `.modules.yaml`, what they
# record, and where a package a project file imports really lies (Vite resolves real paths).
# Run with the scratch environment of probes/README.md: HOME, XDG_* and TMPDIR under /tmp.
#   sh layouts.sh <scratch-dir> <store-dir>
set -e
scratch=$1
store=$2
probes=$(cd "$(dirname "$0")" && pwd)
fixture() {
  dir=$1
  rm -rf "$dir" && mkdir -p "$dir/packages/app/src" "$dir/packages/lib"
  cat > "$dir/package.json" <<'EOF'
{ "name": "layouts", "private": true, "packageManager": "pnpm@12.11.2", "devDependencies": { "zod": "4.4.3" } }
EOF
  printf 'packages:\n  - packages/*\n' > "$dir/pnpm-workspace.yaml"
  cat > "$dir/packages/app/package.json" <<'EOF'
{ "name": "app", "private": true, "dependencies": { "@hono/node-server": "1.19.14", "hono": "4.12.29", "lib": "workspace:*" } }
EOF
  cat > "$dir/packages/lib/package.json" <<'EOF'
{ "name": "lib", "version": "1.0.0", "dependencies": { "ws": "8.21.1" } }
EOF
  echo 'export const x = 1;' > "$dir/packages/lib/index.js"
}
report() {
  dir=$1
  echo "lock.yaml: $(ls "$dir/node_modules/.pnpm/lock.yaml" 2>/dev/null || echo absent)"
  echo ".package-lock.json: $(ls "$dir/node_modules/.package-lock.json" 2>/dev/null || echo absent)"
  node "$probes/modules-fields.mjs" "$dir"
  for name in @hono/node-server hono ws zod lib; do
    path=$dir/packages/app/node_modules/$name
    if [ -e "$path" ]; then real=$(realpath "$path"); else real=absent; fi
    echo "app -> $name: ${real#"$dir"/}"
  done
  for name in ws hono; do
    path=$dir/node_modules/$name
    if [ -e "$path" ]; then real=$(realpath "$path"); else real=absent; fi
    echo "root node_modules/$name: ${real#"$dir"/}"
  done
}
for layout in isolated hoisted shamefully-hoist public-hoist-ws global-virtual-store injected; do
  dir=$scratch/$layout
  fixture "$dir"
  case $layout in
    hoisted) printf 'nodeLinker: hoisted\n' >> "$dir/pnpm-workspace.yaml" ;;
    shamefully-hoist) printf 'shamefullyHoist: true\n' >> "$dir/pnpm-workspace.yaml" ;;
    public-hoist-ws) printf 'publicHoistPattern:\n  - ws\n' >> "$dir/pnpm-workspace.yaml" ;;
    global-virtual-store) printf 'enableGlobalVirtualStore: true\n' >> "$dir/pnpm-workspace.yaml" ;;
    injected) sed -i 's/"lib": "workspace:\*" }/"lib": "workspace:*" }, "dependenciesMeta": { "lib": { "injected": true } }/' "$dir/packages/app/package.json" ;;
  esac
  echo "=== $layout"
  (cd "$dir" && pnpm install --ignore-scripts --store-dir "$store" > "$dir.log" 2>&1) || { echo "install failed"; tail -5 "$dir.log"; continue; }
  report "$dir"
  if [ "$layout" = injected ]; then grep -n "lib@file" -A3 "$dir/node_modules/.pnpm/lock.yaml" | head -8; fi
done
