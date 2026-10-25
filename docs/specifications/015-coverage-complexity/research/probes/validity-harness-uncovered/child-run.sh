#!/usr/bin/env bash
# Throwaway probe (row 015-58). Run from the repository root.
set -euo pipefail
P=docs/specifications/015-coverage-complexity/research/probes/validity-harness-uncovered
OUT=$P/out
SCRATCH=$(mktemp -d /tmp/sq015-58.XXXXXX)
mkdir -p "$OUT" "$SCRATCH/home" "$SCRATCH/cov" "$SCRATCH/cases"
# The corpus's assemble cases, as the comparison writes them (sides.ts).
npx tsx -e '
import { writeFileSync } from "node:fs";
import { CASES } from "./test/keys/validity/cases/index.ts";
const picked = CASES.filter((c) => c.kind === "assemble");
writeFileSync(process.argv[1], JSON.stringify(picked));
console.log("assemble cases:", picked.length);
' "$SCRATCH/cases.json"
# One plain bundle of the driver, packages left as imports, with a source map.
npx esbuild test/keys/validity/driver.ts --bundle --platform=node --format=esm \
  --packages=external --sourcemap --outfile="$OUT/driver.mjs" --log-level=warning
# The child, as sides.ts starts it: a scratch HOME and NODE_V8_COVERAGE.
HOME="$SCRATCH/home" XDG_CONFIG_HOME="$SCRATCH/home/.config" XDG_CACHE_HOME="$SCRATCH/home/.cache" \
XDG_DATA_HOME="$SCRATCH/home/.local/share" XDG_STATE_HOME="$SCRATCH/home/.local/state" \
NODE_V8_COVERAGE="$SCRATCH/cov" \
  node "$OUT/driver.mjs" run "$SCRATCH/cases.json" "$SCRATCH/out.json" "$SCRATCH/cases" none
node "$P/map-child.mjs" "$SCRATCH/cov" "$OUT/driver.mjs" "$SCRATCH/out.json"
rm -rf "$SCRATCH"
