#!/usr/bin/env bash
# Throwaway research fixture. Run from the repository root.
set -euo pipefail
probe=docs/specifications/011-core/research/probes/issue-263
node -e 'const os=require("node:os"); const cpus=os.cpus().length; const load=os.loadavg(); console.log(JSON.stringify({time:new Date().toISOString(),node:process.version,cpus,load})); if(load[0]>cpus) process.exit(75)'
mkdir -p "$probe/.runtime/source" "$probe/.runtime/tmp"
git archive squeal--v0.1.591 src package.json test/harness/helpers.ts test/helpers/policy.ts test/state/helpers.ts test/status/helpers.ts test/store/helpers.ts | tar -x -C "$probe/.runtime/source"
git rev-parse 'squeal--v0.1.591^{commit}'
TMPDIR="$PWD/$probe/.runtime/tmp" pnpm exec vitest run --config "$probe/vitest.config.ts" --silent=false --disableConsoleIntercept
