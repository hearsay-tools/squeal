#!/bin/sh
# Throwaway (issue 10 research). Builds a cezar-shaped fixture repository at $1:
# a `web` Vitest project (src/**/*.test.ts), a slow `e2e` project (e2e/*.e2e.ts),
# baseline.onStart from $2 (default lookup-only). Installs vitest 4.1.12 with npm.
# The edited unit test sleeps UNIT_SLEEP_MS (read from the daemon's environment) first.
set -eu
dir=$1
onstart=${2:-lookup-only}
mkdir -p "$dir/packages/web/src/lib" "$dir/packages/web/e2e"
cd "$dir"
git init -q -b main
cat > package.json <<'J'
{ "name": "issue10-fixture", "private": true, "type": "module",
  "devDependencies": { "vitest": "4.1.12" } }
J
cat > vitest.config.ts <<'J'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: ['./packages/web/vitest.config.ts', './packages/web/e2e/vitest.config.ts'],
  },
})
J
cat > packages/web/vitest.config.ts <<'J'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { name: 'web', root: import.meta.dirname, include: ['src/**/*.test.{ts,tsx}'] },
})
J
cat > packages/web/e2e/vitest.config.ts <<'J'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { name: 'e2e', root: import.meta.dirname, include: ['**/*.e2e.ts'], fileParallelism: false },
})
J
cat > squeal.config.json <<J
{
  "baseline": { "onStart": "$onstart" },
  "inputs": { "packages/web/e2e/*.e2e.ts": ["packages/web/src/**", "packages/web/e2e/**"] },
  "slow": { "include": ["packages/web/e2e/*.e2e.ts"], "maxWorkers": 1, "maxParallel": 1 }
}
J
# The import-free helper, its unit test, and an e2e file importing it.
cat > packages/web/src/lib/nav-contract.ts <<'J'
export function navReady(path: string): boolean {
  return path.startsWith('/p/')
}
J
cat > packages/web/src/lib/nav-contract.test.ts <<'J'
import { expect, it } from 'vitest'
import { navReady } from './nav-contract'
it('accepts a project path', async () => {
  await new Promise((r) => setTimeout(r, Number(process.env.UNIT_SLEEP_MS ?? 0)))
  expect(navReady('/p/x')).toBe(true)
}, 30000)
J
for n in 1 2 3 4 5; do
  cat > packages/web/src/lib/other-$n.test.ts <<J
import { expect, it } from 'vitest'
it('other $n', () => { expect($n).toBe($n) })
J
done
cat > packages/web/e2e/nav.e2e.ts <<'J'
import { expect, it } from 'vitest'
import { navReady } from '../src/lib/nav-contract'
it('e2e nav', async () => { await new Promise((r) => setTimeout(r, 3000)); expect(navReady('/p/x')).toBe(true) })
J
# A component and its test the reporter deleted in the same edit, and a build output directory.
cat > packages/web/src/lib/backdrop.ts <<'J'
export const backdrop = 'ghost'
J
cat > packages/web/src/lib/backdrop.test.ts <<'J'
import { expect, it } from 'vitest'
import { backdrop } from './backdrop'
it('backdrop', () => { expect(backdrop).toBe('ghost') })
J
mkdir -p packages/server/dist
for n in $(seq 1 50); do echo "export const v$n = $n" > packages/server/dist/m$n.js; done
printf 'node_modules\n' > .gitignore
npm install --silent --no-audit --no-fund >/dev/null
git add -A && git -c user.email=p@x -c user.name=probe commit -qm fixture
echo "fixture at $dir ($onstart)"
