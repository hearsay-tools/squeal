#!/bin/sh
# 011-162 probe, not product code (brief question 3). Breaks a copy of the `isolated` layout of
# layouts.sh one way at a time, applies section 3's rule (trust.mjs), then asks pnpm itself
# (`pnpm install --frozen-lockfile --offline`) whether it notices and repairs the install.
# Run with the scratch environment of probes/README.md.
#   sh trust.sh <layouts-dir> <store-dir>
set -e
base=$1/isolated
store=$2
probes=$(cd "$(dirname "$0")" && pwd)
for case in none delete-folder add-file replace-folder undeclared-copy retarget-link pnpm-update; do
  dir=$1/trust-$case
  rm -rf "$dir" && cp -a "$base" "$dir"
  sleep 1
  case $case in
    delete-folder) rm -rf "$dir/node_modules/.pnpm/hono@4.12.29" ;;
    add-file) touch "$dir/node_modules/.pnpm/hono@4.12.29/node_modules/hono/extra.js" ;;
    replace-folder) mv "$dir/node_modules/.pnpm/hono@4.12.29/node_modules/hono" "$dir/hono.tmp" && mv "$dir/hono.tmp" "$dir/node_modules/.pnpm/hono@4.12.29/node_modules/hono" ;;
    undeclared-copy) cp -r "$dir/node_modules/.pnpm/ws@8.21.1/node_modules/ws" "$dir/node_modules/ws" ;;
    retarget-link) ln -sfn ../../../node_modules/.pnpm/ws@8.21.1/node_modules/ws "$dir/packages/app/node_modules/hono" ;;
    pnpm-update) (cd "$dir" && sed -i 's/"hono": "4.12.29"/"hono": "4.12.30"/' packages/app/package.json && pnpm install --ignore-scripts --store-dir "$store" >/dev/null 2>&1) ;;
  esac
  rule=$(node "$probes/trust.mjs" "$dir" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.stale===null?"trusted":"stale ("+r.stale+")",r.orphans?"orphans "+r.orphans:"")})')
  before=$(ls "$dir/node_modules/.pnpm/hono@4.12.29/node_modules/hono/package.json" 2>/dev/null || echo "no hono@4.12.29 folder")
  pnpm=$(cd "$dir" && pnpm install --frozen-lockfile --offline --ignore-scripts --store-dir "$store" 2>&1 | grep -E "up to date|Done|ERR" | head -2 | tr '\n' ' ')
  after=$(ls "$dir/node_modules/.pnpm/hono@4.12.29/node_modules/hono/package.json" 2>/dev/null || echo "no hono@4.12.29 folder")
  echo "$case: rule $rule | pnpm: $pnpm | hono@4.12.29 before: ${before#"$dir"/} after: ${after#"$dir"/}"
done
