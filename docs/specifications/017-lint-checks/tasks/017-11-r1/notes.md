# 017-11.R1: no-runner CI failure

Worker 19d7ebef, 2026-10-27. Repair of candidate CI 40419094538, job 121908710503 (Node 24): `test/daemon/composite-runner.test.ts`, "keeps the Vitest note when neither runner is configured or detected". No file under `src/` changed.

## Cause

pnpm's `node_modules/.bin/vitest` shim exports `NODE_PATH` before it starts Vitest:

```
$basedir/../.pnpm/vitest@5.0.3_…/node_modules/vitest/node_modules
$basedir/../.pnpm/vitest@5.0.3_…/node_modules
$basedir/../.pnpm/node_modules
```

The second entry holds `vitest` itself. Vitest's workers inherit it, and `childEnv` (`test/daemon/helpers.ts`) copied it into every test daemon's env. `loadVitest` resolves `vitest/node` with `createRequire(<root>/package.json).resolve`, and Node's CommonJS resolver searches `NODE_PATH` after the `node_modules` folders above the root. So the bare fixture under `/tmp` resolved the repository's own Vitest, the Vitest runner started, and no "vitest could not start" note was written. The only note was the coverage provider's, as CI shows.

npm never set `NODE_PATH`: `npx vitest` and `npm exec` run the `.bin` symlink. So the test passed on main (0.1.359, npm) and failed on the first pnpm candidate.

Evidence (this worktree, a fresh `pnpm install --frozen-lockfile` before the session):

- Probe: from a fresh `/tmp` directory holding only `{ "type": "module" }`, `createRequire(...).resolve("vitest/node")` fails ("Cannot find module 'vitest/node'") with no `NODE_PATH` and resolves to `node_modules/.pnpm/vitest@5.0.3_…/node_modules/vitest/dist/node.js` with the shim's `NODE_PATH`.
- Before the fix, `pnpm exec vitest run test/daemon/composite-runner.test.ts -t "neither runner"` fails on Node 24.21.0 and on Node 22.19.0 with CI's received value (only the coverage note). The same test passes on Node 24.21.0 when started as `env -u NODE_PATH node node_modules/vitest/vitest.mjs`.
- So the failure is not Node 24's. The Node 24 job only finished first: it runs `test/version-sensitive.txt`, which lists this file. In the same CI run, Node 22 shards 1/3 and 3/3 passed without this file; shard 2/3 was still running when this note was written. It runs `pnpm exec vitest` too, so this file should fail there the same way.

Ruled out: `ready` before the note. The manifest `{ "type": "module" }` declares no dependencies, so `awaitsInstall` is false and the daemon awaits `vitestRunner.open()` before it sets `ready` (`src/core/daemon/daemon.ts`, the `Promise.all` before `#setPhase("ready")`). A failed open writes the note synchronously (`#note` → `writeNote` → `appendNote`). If Vitest had failed to resolve, the note would be in the store before `ready`.

Squeal's own daemon (plugin 0.1.359) runs with no `NODE_PATH` (checked in `/proc/<pid>/environ`). So local Squeal results for daemon tests were already made without it, and they could not show this failure.

## Fix

- `childEnv` drops `NODE_PATH`, beside `NODE_OPTIONS`, `VITEST*` and `GIT_*`. Test daemons get the same env as under npm and as under Squeal's daemon.
- The original assertion is unchanged. The test now also proves its fixture has no runner: `vitestDetected(root)` is false, and `vitest/node` does not resolve from the root in the daemon's env (`vitestFrom`, a `node -e` probe with the daemon's env and Node binary, the way `loadVitest` resolves).
- Regression: "starts its daemons without the test's NODE_PATH, from which Vitest resolves anywhere". It stubs `NODE_PATH` to the repository's `node_modules`, checks the probe resolves Vitest with it (so the probe can tell the two cases apart), and checks the fixture's env has no `NODE_PATH` and resolves no Vitest. It does not depend on how Vitest was started: before the fix it failed when started with no `NODE_PATH` at all ("expected '/home/agent/…' to be undefined").

## Scope of the helper change

`childEnv` is used by 28 test files, and through `createFixtureRepo` by every daemon fixture (Squeal selected 103 files that read `test/daemon/helpers.ts`). With `NODE_PATH` gone, a fixture daemon resolves packages only through the `node_modules` folders above it. Under pnpm's isolated layout the root `node_modules` has only the direct dependencies. The packages that fixtures import (`test/fixtures`) are `vitest`, packages inside the fixtures' own `node_modules`, the toolchain workspace's `typescript-eslint`, and `@earendil-works/*`, all reachable without `NODE_PATH`. If CI shows another daemon test that fails only without `NODE_PATH`, it depended on a package that npm hoisted and pnpm does not, and needs that dependency declared, not the old env back.

## Open for the coordinator (product, not changed)

`loadVitest` (`src/runners/vitest/load.ts`) honours `NODE_PATH`, because `createRequire().resolve` searches it. Spec 001 D11 says Vitest is "resolved from the worktree root". A user daemon started with a `NODE_PATH`, for example from a pnpm shim of a package that depends on Squeal, could load a Vitest the worktree root does not resolve. This row does not change it. Default: no product change; a later row can decide whether the daemon should resolve without `NODE_PATH`. `require.resolve(id, { paths: [root] })` is no such fix: probed on Node 24.21.0, it still resolves through `NODE_PATH`.
