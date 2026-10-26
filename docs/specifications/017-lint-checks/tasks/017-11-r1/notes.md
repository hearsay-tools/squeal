# 017-11.R1: no-runner CI failure

Worker 19d7ebef, 2026-10-27. Repair of candidate CI 40419094538: `test/daemon/composite-runner.test.ts`, "keeps the Vitest note when neither runner is configured or detected" (job 121908710503, Node 24, and Node 22 shard 2/3), and two cases of `test/runners/vitest/load.test.ts` (Node 22 shard 2/3). All three have one cause. No file under `src/` changed.

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
- So the failure is not Node 24's. The Node 24 job only finished first: it runs `test/version-sensitive.txt`, which lists this file. In the same CI run, Node 22 shards 1/3 and 3/3 passed; shard 2/3 (Node 22.19) failed this test the same way, two `load.test.ts` cases (below), and `test/cli/install-sh.test.ts` (the installer's `SQUEAL_VERSION` is 0.1.359 against 0.1.360; not this cause, the coordinator fixes it).

Ruled out: `ready` before the note. The manifest `{ "type": "module" }` declares no dependencies, so `awaitsInstall` is false and the daemon awaits `vitestRunner.open()` before it sets `ready` (`src/core/daemon/daemon.ts`, the `Promise.all` before `#setPhase("ready")`). A failed open writes the note synchronously (`#note` → `writeNote` → `appendNote`). If Vitest had failed to resolve, the note would be in the store before `ready`.

Squeal's own daemon (plugin 0.1.359) runs with no `NODE_PATH` (checked in `/proc/<pid>/environ`). So local Squeal results for daemon tests were already made without it, and they could not show this failure.

## Fix

- `childEnv` drops `NODE_PATH`, beside `NODE_OPTIONS`, `VITEST*` and `GIT_*`. Test daemons get the same env as under npm and as under Squeal's daemon.
- The original assertion is unchanged. The test now also proves its fixture has no runner: `vitestDetected(root)` is false, and `vitest/node` does not resolve from the root in the daemon's env (`vitestFrom`, a `node -e` probe with the daemon's env and Node binary, the way `loadVitest` resolves).
- Regression: "starts its daemons without the test's NODE_PATH, from which Vitest resolves anywhere". It stubs `NODE_PATH` to the repository's `node_modules`, checks the probe resolves Vitest with it (so the probe can tell the two cases apart), and checks the fixture's env has no `NODE_PATH` and resolves no Vitest. It does not depend on how Vitest was started: before the fix it failed when started with no `NODE_PATH` at all ("expected '/home/agent/…' to be undefined").

## The same cause in the test process: `load.test.ts`

"rejects with a factual reason when the project has no Vitest" got a resolved `vitest/node` module, and "is a runner failure with a note, not a crash" got `open()` true. Both call `loadVitest` on a bare `/tmp` project inside the Vitest worker, which has the shim's `NODE_PATH` itself. Node's CommonJS loader reads `NODE_PATH` once at startup (`Module._initPaths`) into the global lookup paths that `createRequire().resolve` searches, so `childEnv` cannot help here.

Evidence: the committed file fails both cases under `pnpm exec vitest run test/runners/vitest/load.test.ts` on Node 24.21.0 and 22.19.0, with CI's messages ("promise resolved … instead of rejecting", "expected true to be false"). A probe on both versions: a process started with `NODE_PATH=<repo>/node_modules` resolves `vitest/node` from a bare directory; after `delete process.env.NODE_PATH` and `Module._initPaths()` it does not.

Fix: before each test, the file stubs `NODE_PATH` away (`vi.stubEnv("NODE_PATH", undefined)`) and calls `Module._initPaths()`; after each, it restores the env and calls it again. The original assertions are unchanged. All tests in the file resolve Vitest as the project resolves it, so the whole file drops it, including "loads vitest/node as the project resolves it", which resolves from the repository's own `node_modules`.

`Module._initPaths` is not documented. It has been on `Module` for a long time and is present on Node 22.19.0 and 24.21.0. If a later Node removes it, the call throws and every test in the file fails loudly; it cannot pass silently.

Regression: "resolves no Vitest for a project without one once dropped, though it did before". It stubs `NODE_PATH` to the repository's `node_modules` and reads the paths again, checks that `vitest/node` then resolves from the bare project, drops it, and checks `loadVitest` rejects. A mutant without the `_initPaths()` call in `dropNodePath` fails it when Vitest starts with no `NODE_PATH` (1 failed, 3 passed), and fails all three no-Vitest tests under `pnpm exec vitest` (3 failed, 1 passed).

## Scope of the helper change

`childEnv` is used by 28 test files, and through `createFixtureRepo` by every daemon fixture (Squeal selected 103 files that read `test/daemon/helpers.ts`). With `NODE_PATH` gone, a fixture daemon resolves packages only through the `node_modules` folders above it. Under pnpm's isolated layout the root `node_modules` has only the direct dependencies. The packages that fixtures import (`test/fixtures`) are `vitest`, packages inside the fixtures' own `node_modules`, the toolchain workspace's `typescript-eslint`, and `@earendil-works/*`, all reachable without `NODE_PATH`. If CI shows another daemon test that fails only without `NODE_PATH`, it depended on a package that npm hoisted and pnpm does not, and needs that dependency declared, not the old env back.

## Other ways, not taken

- Drop `NODE_PATH` once for every test process: `delete process.env.NODE_PATH` in the global setup (`test/global-teardown.ts`, run before Vitest starts its workers), so CI's test processes run as Squeal's and npm's did. It would cover future cases too and make the `childEnv` and `load.test.ts` changes unneeded. It touches every test file in CI, and the files are not in this row's ownership. Not tried.
- Run the no-Vitest cases in a child process started without `NODE_PATH`. It would move the code under test out of the test's module graph and rewrite the assertions over a child's output.

## Open for the coordinator (product, not changed)

`loadVitest` (`src/runners/vitest/load.ts`) honours `NODE_PATH`, because `createRequire().resolve` searches it. Spec 001 D11 says Vitest is "resolved from the worktree root". A user daemon started with a `NODE_PATH`, for example from a pnpm shim of a package that depends on Squeal, could load a Vitest the worktree root does not resolve. This row does not change it. Default: no product change; a later row can decide whether the daemon should resolve without `NODE_PATH`. `require.resolve(id, { paths: [root] })` is no such fix: probed on Node 24.21.0, it still resolves through `NODE_PATH`.

## Checks run (2026-10-27, host load 33 to 47 on 24 CPUs)

- `pnpm exec vitest run test/daemon/composite-runner.test.ts` (the real shim): 27 passed on Node 24.21.0 and on Node 22.19.0.
- `pnpm exec vitest run test/runners/vitest/load.test.ts`: 4 passed on Node 24.21.0 and on Node 22.19.0; also 4 passed when started as `env -u NODE_PATH node node_modules/vitest/vitest.mjs`.
- `pnpm run lint` (Biome) and `pnpm run typecheck` (tsc): clean.
- Squeal (no `NODE_PATH` in its processes): `load.test.ts` current, no failures; the 103 files that read `test/daemon/helpers.ts` ran with no failure caused by this change. `test/cli/warmup.test.ts` failed once on its count of host-load progress lines at 2.29 load per CPU, and passed on Squeal's load retry; Squeal records it flaky at the same inputs before this row.
- Not run: a full suite (CI gives it), any build.
