#!/usr/bin/env bash
# Throwaway probe for issue 43 (research only). Builds a one-file Vitest repo
# outside the worktree with runner.timeoutMs = 5000, so the "timed out after N s"
# path runs in seconds instead of 600 s. The test's sleep is read from a file
# outside the fixture ($DELAY) so the same key can be slow, then fast.
set -euo pipefail
FIX=${1:-/tmp/issue43-fixture}
DELAY=${DELAY:-/tmp/issue43-delay-ms}
rm -rf "$FIX"; mkdir -p "$FIX"; cd "$FIX"
git init -q .
cat > package.json <<'J'
{ "name": "issue43-fixture", "private": true, "type": "module" }
J
cat > vitest.config.ts <<'J'
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { testTimeout: 120000 } });
J
cat > squeal.config.json <<'J'
{ "runner": { "timeoutMs": 5000 } }
J
mkdir -p test
cat > test/slow.test.ts <<J
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
it("sleeps as long as the delay file says", async () => {
  const ms = Number(readFileSync("$DELAY", "utf8"));
  await new Promise((r) => setTimeout(r, ms));
  expect(ms).toBeGreaterThanOrEqual(0);
});
J
printf 'node_modules\n' > .gitignore
npm i -D --no-audit --no-fund vitest@^5.0.3 >/dev/null 2>&1
git add -A && git -c user.email=p@p -c user.name=probe commit -qm fixture
echo "fixture at $FIX, vitest $(node -p "require('./node_modules/vitest/package.json').version")"
