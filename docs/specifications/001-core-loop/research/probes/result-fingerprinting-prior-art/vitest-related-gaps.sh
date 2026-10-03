#!/usr/bin/env bash
# Throwaway probe. Which kinds of dependency does `vitest related` (Vitest 5.0.3) miss?
# Builds a fixture in a temp dir; nothing is written into the repo.
set -euo pipefail
D=$(mktemp -d /tmp/squeal-related-XXXX); cd "$D"
npm init -y >/dev/null; npm i -s -D vitest@5.0.3 >/dev/null 2>&1
mkdir -p src fixtures test
echo 'export const a = () => 1' > src/a.ts
echo 'export const dyn = () => 2' > src/dyn.ts
echo '{"n": 3}' > fixtures/data.json
echo 'export const setupValue = 4' > src/setup-helper.ts
echo 'import "../src/setup-helper"' > test/setup.ts
cat > vitest.config.ts <<'C'
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { setupFiles: ['test/setup.ts'] } })
C
cat > test/static.test.ts <<'T'
import { a } from '../src/a'; import { test, expect } from 'vitest'
test('static', () => expect(a()).toBe(1))
T
cat > test/fsread.test.ts <<'T'
import { readFileSync } from 'node:fs'; import { test, expect } from 'vitest'
test('fsread', () => expect(JSON.parse(readFileSync('fixtures/data.json', 'utf8')).n).toBe(3))
T
cat > test/dynamic.test.ts <<'T'
import { test, expect } from 'vitest'
const name = ['dyn'][0]
test('dynamic', async () => expect((await import(`../src/${name}.ts`)).dyn()).toBe(2))
T
cat > test/snap.test.ts <<'T'
import { test, expect } from 'vitest'
test('snap', () => expect({ x: 1 }).toMatchSnapshot())
T
npx vitest run >/dev/null 2>&1 || true   # first run writes the snapshot and results cache
for f in src/a.ts fixtures/data.json src/dyn.ts test/__snapshots__/snap.test.ts.snap src/setup-helper.ts test/setup.ts package.json; do
  printf '%-40s -> ' "related $f"
  rm -f out.json
  npx vitest related --run "$f" --reporter=json --outputFile=out.json >/dev/null 2>&1 || true
  if [ -f out.json ]; then node -e 'const j=require("./out.json");
    console.log(j.testResults.map(t=>t.name.split("/test/")[1]).sort().join(", ")||"(none)")'
  else echo "(no tests run)"; fi
done
echo "results cache: $(find node_modules/.vite -name results.json | head -1)"
cat "$(find node_modules/.vite -name results.json | head -1)"; echo
