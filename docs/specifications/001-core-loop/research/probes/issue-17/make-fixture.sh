#!/bin/sh
# Throwaway (research issue-17). Builds one fixture repository at <dir>:
# a fast unit file, three slow "browser" files, and declared inputs that make
# every src/ file an input of every browser file, as cezarion's
# squeal.config.json does for packages/web/e2e/*.e2e.ts.
# usage: make-fixture.sh <dir> <node_modules template dir> <browser delay ms>
set -eu
D=$1; TPL=$2; DELAY=$3
rm -rf "$D"; mkdir -p "$D/src" "$D/e2e"; cd "$D"
cp "$TPL/package.json" "$TPL/package-lock.json" .
cp -a "$TPL/node_modules" .
printf 'node_modules\n' > .gitignore
cat > vitest.config.ts <<'X'
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts", "e2e/**/*.e2e.ts"] } });
X
printf 'export const a = 1;\n' > src/a.ts
cat > src/unit.test.ts <<'X'
import { expect, test } from "vitest";
import { a } from "./a";
test("a is one", () => expect(a).toBe(1));
X
printf 'export const delayMs = %s;\n' "$DELAY" > e2e/delay.ts
for n in 1 2 3; do
cat > e2e/b$n.e2e.ts <<'X'
import { expect, test } from "vitest";
import { delayMs } from "./delay";
test("browser flow", async () => {
  await new Promise((r) => setTimeout(r, delayMs));
  expect(1).toBe(1);
}, 600_000);
X
done
cat > squeal.config.json <<'X'
{
  "baseline": { "onStart": "lookup-only" },
  "inputs": { "e2e/*.e2e.ts": ["src/**"] },
  "slow": { "include": ["e2e/*.e2e.ts"], "maxWorkers": 1, "maxParallel": 1 },
  "runner": { "tierSize": 4, "timeoutMs": 600000 },
  "daemon": { "idleExitMinutes": 30 }
}
X
git init -q; git add -A; git -c user.email=probe@example.invalid -c user.name=probe commit -qm fixture
echo "fixture at $D ($(git rev-parse --short HEAD))"
