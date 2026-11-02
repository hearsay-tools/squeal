#!/bin/sh
# Throwaway (019-01, runner-trigger). Builds a two-runner fixture repository
# under $TMPDIR: Vitest for test/**, node:test for node/**. The node:test
# runner's whole glob is a slow tier with slow.trigger "idle".
# Usage: make-fixture.sh <worktree root> <fixture dir> [variant]
#   variant "include" (default): slow.include lists node/**/*.test.mjs
#   variant "flag": the nodeTest entry carries slow: true instead
set -eu
WT=$1; FX=$2; VARIANT=${3:-include}
rm -rf "$FX"; mkdir -p "$FX/src" "$FX/test" "$FX/node"
cd "$FX"
git init -q -b main .
ln -s "$WT/node_modules" node_modules
cat > package.json <<'J'
{ "name": "rt-fixture", "private": true, "type": "module",
  "devDependencies": { "vitest": "*" } }
J
cat > vitest.config.ts <<'J'
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
J
cat > src/math.js <<'J'
export const add = (a, b) => a + b;
J
cat > test/math.test.ts <<'J'
import { expect, test } from "vitest";
import { add } from "../src/math.js";
test("adds", () => { expect(add(1, 2)).toBe(3); });
J
cat > node/math.test.mjs <<'J'
import { test } from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/math.js";
test("adds in node", () => { assert.equal(add(2, 2), 4); });
J
if [ "$VARIANT" = flag ]; then
cat > squeal.config.json <<'J'
{ "nodeTest": [ { "name": "node", "include": ["node/**/*.test.mjs"], "slow": true } ],
  "slow": { "trigger": "idle" } }
J
else
cat > squeal.config.json <<'J'
{ "nodeTest": [ { "name": "node", "include": ["node/**/*.test.mjs"] } ],
  "slow": { "include": ["node/**/*.test.mjs"], "trigger": "idle" } }
J
fi
printf 'node_modules\n' > .gitignore
git add -A && git -c user.email=p@p -c user.name=p commit -qm fixture
