#!/bin/sh
# Builds the synthetic fixture for row 011-394 (throwaway): N small Vitest files
# that all import src/shared.ts, so one edit there re-keys every one of them,
# plus test/hang.test.ts, which blocks its worker thread while the marker file
# hang.on exists (Atomics.wait: no CPU, and Vitest's test timeout cannot stop it,
# as a synchronous loop cannot be stopped).
# Usage: make-fixture.sh <dir> [files=1200] [sleep-ms=60] [timeout-ms=120000]
set -eu
dir=$1; n=${2:-1200}; sleep=${3:-60}; timeout=${4:-120000}
mkdir -p "$dir/src" "$dir/test/gen"
cd "$dir"
cat > package.json <<J
{ "name": "syn-394", "private": true, "type": "module",
  "devDependencies": { "vitest": "4.1.10" } }
J
cat > vitest.config.ts <<J
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"], maxWorkers: 4 } });
J
cat > squeal.config.json <<J
{ "baseline": { "onStart": "lookup-only" },
  "runner": { "tierSize": 4, "timeoutMs": $timeout } }
J
printf 'export const shared = 1;\n' > src/shared.ts
i=1
while [ $i -le $n ]; do
  f=$(printf 'test/gen/f%04d.test.ts' $i)
  cat > "$f" <<J
import { expect, test } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";
import { shared } from "../../src/shared.js";
test("f$i", async () => { await sleep($sleep); expect(shared).toBeGreaterThan(0); });
J
  i=$((i + 1))
done
cat > test/hang.test.ts <<'J'
import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { shared } from "../src/shared.js";
test("hang while hang.on exists", () => {
  // Blocks the worker's thread in 1 s steps, without CPU, while the marker exists.
  const cell = new Int32Array(new SharedArrayBuffer(4));
  while (existsSync(new URL("../hang.on", import.meta.url))) Atomics.wait(cell, 0, 0, 1000);
  expect(shared).toBeGreaterThan(0);
});
J
printf 'node_modules\nhang.on\n' > .gitignore
git init -q -b main . && git add -A && git -c user.email=probe@example.invalid -c user.name=probe commit -qm fixture
pnpm install --offline --silent >/dev/null 2>&1 || pnpm install --silent
echo "fixture $dir: $n generated files, sleep ${sleep} ms, runner.timeoutMs $timeout"
