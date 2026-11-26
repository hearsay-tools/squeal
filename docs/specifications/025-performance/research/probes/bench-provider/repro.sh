#!/usr/bin/env bash
# Throwaway probe for research 025-22. Runs on a boat.dev sandbox where
# /home/user/bench and /home/user/plugin-0 were pushed as bench/boat-run.sh does.
# Makes two bench projects (gen-project.mjs, pnpm install as run-all.mjs does):
# A floats (no lockfile, today's newest vite), B pins vite through pnpm overrides.
# Runs probe.mjs in each with the plugin's provider. Usage: repro.sh <vite pin for B>
set -uo pipefail
PIN=${1:-8.3.8}
H=/home/user
P=$H/plugin-0/dist/coverage/provider.mjs
ls -l "$P"
node --version; pnpm --version
for v in float pin; do
  d=$H/proj-$v
  rm -rf "$d"
  node $H/bench/gen-project.mjs "$d" 3 >/dev/null
  if [ $v = pin ]; then
    node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f));p.pnpm={overrides:{vite:process.argv[2]}};require("fs").writeFileSync(f,JSON.stringify(p,null,2))' "$d/package.json" "$PIN"
  fi
  (cd "$d" && pnpm install --silent) || echo "install $v failed"
  echo "=== $v: $(cd "$d" && pnpm ls --depth 1 2>/dev/null | grep -E 'vite |vitest ' | tr -s ' ' | tr '\n' ' ')"
  timeout 600 node $H/probe.mjs "$d" "$P" 2>&1 | sed "s|$H|~|g"
  echo "exit $v: ${PIPESTATUS[0]}"
done
