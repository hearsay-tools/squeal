#!/usr/bin/env bash
# Throwaway (row 021-04): a small Vitest project under $TMPDIR/rs/fixture, a git repository,
# installed offline from this host's warm pnpm store (no download).
set -euo pipefail
. "$(dirname "$0")/env.sh"
rm -rf "$FIXTURE"; mkdir -p "$FIXTURE"/{src,test,fixtures}; cd "$FIXTURE"
cat > package.json <<'J'
{ "name": "rs-fixture", "private": true, "type": "module", "devDependencies": { "vitest": "5.0.3" } }
J
cat > vitest.config.ts <<'J'
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
J
cat > src/math.ts <<'J'
export const add = (a: number, b: number): number => a + b;
J
cat > src/greet.ts <<'J'
import { add } from "./math.js";
export const greet = (name: string): string => `hello ${name} ${add(1, 1)}`;
J
cat > fixtures/data.json <<'J'
{ "name": "remote" }
J
cat > test/math.test.ts <<'J'
import { expect, test } from "vitest";
import { add } from "../src/math.js";
test("adds", () => { expect(add(2, 3)).toBe(5); });
J
cat > test/greet.test.ts <<'J'
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { greet } from "../src/greet.js";
test("greets from data", () => {
  const data = JSON.parse(readFileSync(new URL("../fixtures/data.json", import.meta.url), "utf8"));
  expect(greet(data.name)).toBe("hello remote 2");
});
J
cat > test/slow.test.ts <<'J'
import { expect, test } from "vitest";
test("waits", async () => { await new Promise((r) => setTimeout(r, Number(process.env.SLOW_MS ?? 6000))); expect(1).toBe(1); }, 60_000);
J
printf 'node_modules\n' > .gitignore
git init -q && git add -A && git -c user.email=p@x -c user.name=probe commit -qm fixture
pnpm install --offline --config.confirmModulesPurge=false >/dev/null
git add pnpm-lock.yaml && git -c user.email=p@x -c user.name=probe commit -qm lock
du -sh node_modules; find -L node_modules -type f | wc -l
