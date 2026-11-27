# 028 Jest runner: Wave 4.5 repair brief (candidate 0.1.648 B1)

Fixes the single proven blocker B1 from `docs/specifications/028-jest-runner/reviews/0.1.648.md`: native Node modules loaded inside `warm-worker.cjs` (for example a local Jest transformer and a `helper.cjs` it calls `require("./helper.cjs")` on, either dynamically in `getCacheKey`/`process` or at module scope) stay cached in Node's module cache across `kind: "change"` invalidation, producing stale passes and losing the helper from subsequent batch observations.

### Read first

- `docs/specifications/028-jest-runner/reviews/0.1.648.md` (B1 section and "Inputs for the repair and next wave")
- `src/runners/jest/runtime/warm-worker.cjs`
- `src/runners/jest/run/warm.ts`
- `src/runners/jest/run/run.ts`
- `src/runners/jest/adapter.ts`
- `test/runners/jest/warm.test.ts`

### File ownership (strict)

- `src/runners/jest/runtime/warm-worker.cjs`
- `src/runners/jest/run/warm.ts`
- `src/runners/jest/run/run.ts`
- `src/runners/jest/adapter.ts`
- `test/runners/jest/warm.test.ts`

Do not edit any other files. Never run `pnpm run build` or a full test suite. Pass `TMPDIR=/tmp` when running Vitest on Jest tests so `/tmp/squeal-jest-29-*` and `/tmp/squeal-jest-30-*` caches are reused without installing or modifying them.

### Design: single freshness and observation owner for native worktree modules in warm workers

1. **Track native worktree modules in `src/runners/jest/runtime/warm-worker.cjs`:**
   - Pass `root` (the real worktree root) in the `init` message from `warm.ts` (`WarmStart.root`).
   - Record every native Node worktree file loaded inside `warm-worker.cjs` (paths inside `root`, outside `node_modules` and `.git`, plus their real path when inside `root`):
     - Snapshot `baseline = new Set(Object.keys(require.cache))` before `init` loads the project's config/Jest.
     - Track CJS loads via `Module._load` (recording `Module._resolveFilename(request, parent, isMain)` BEFORE calling the original `_load`, so even a helper that throws at load time is recorded!) AND scanning `Object.keys(require.cache)` not in `baseline`.
     - Track native ESM loads via `module.registerHooks({ load(url, context, next) { recordNative(url); return next(url, context); } })` (wrapped in `try/catch` for safety).
     - Track two sets of absolute worktree paths (normalized to `root`, outside `node_modules` and `.git`):
       - `hostModules`: every native worktree module loaded during `init` OR during any `run()` batch.
       - `runtimeHostModules`: every native worktree module loaded specifically during `run()` batches (after `init` completes — e.g. local Jest transformers, resolvers, test environments, and any worktree helpers they `require()`/`import()`, both dynamic and module-scope; note that ordinary source/test/manual-mock files execute inside Jest's VM sandbox, never through Node's `Module._load` or `registerHooks`, so they do NOT enter `hostModules` or `runtimeHostModules`).
     - Also record any worktree file in `require.cache` loaded during `run()` if it wasn't already recorded before `init` completes.
   - Include `hostModules` (sorted array of absolute paths) in `ready`, `done`, and `error` IPC replies, and `runtimeHostModules` (sorted array of absolute paths) in `done` IPC replies.

2. **Retire affected warm workers on edit (`src/runners/jest/run/warm.ts`, `src/runners/jest/adapter.ts`):**
   - On `WarmWorker`, store `readonly hostModules = new Set<RelativePath>()` (worktree-relative paths normalized via `WorktreePaths`, updated from `ready` and `done` replies).
   - Add `recycleFor(changed: ReadonlySet<RelativePath>): Promise<void>` on `JestWarmPool`: retires and shuts down any worker whose `hostModules` intersects `changed` (idle workers shut down now; busy workers marked `retired = true` so they exit right after their batch).
   - In `adapter.ts`'s `invalidate(changed)`:
     - Keep existing full `warmPool.recycle()` on `reopen()`, `coverage.changed()`, or any `kind !== "change"`.
     - For `kind === "change"` edits that did not trigger full recycle: call `await warmPool?.recycleFor(new Set(changed.map((p) => p.path)))`!
     - Because ordinary VM-sandboxed source and manual-mock edits are NOT in `hostModules`, they continue reusing the SAME warm worker PID!
     - Because any local transformer / resolver / test environment / helper module loaded natively by Node IS in `hostModules`, editing it immediately retires that warm worker so the next run spawns a fresh worker PID with a clean Node module cache and fresh module-scope imports!

3. **Keep cached, still-used native dependencies in batch observations (`src/runners/jest/run/warm.ts`, `src/runners/jest/run/run.ts`, `src/runners/jest/adapter.ts`):**
   - Return each warm batch's `runtimeHostModules: readonly AbsolutePath[]` (from its `done` IPC reply) through `WarmRun` / `runJest` (e.g. `JestRun.hostObserved?: readonly AbsolutePath[]` or per-batch `hostModules`).
   - In `adapter.ts`'s `runProject`, when `observe !== null` and a warm run completed files with non-empty `runtimeHostModules`:
     - Merge those `runtimeHostModules` (normalized through `paths.toRelative(...)`, outside `node_modules` and `skip`) into each completed test file's observed paths (`observed` entry on `RunReport`, deduplicated and sorted)!
     - Verify that on Run 2 (e.g. editing `test/a.test.js` without editing `helper.cjs`, reusing the SAME warm worker PID), `helper.cjs` and `transform.cjs` STILL appear in `report.observed` for `test/a.test.js`!
     - Verify that when `observe.runtimeInputs` is `false` (`observe === null`), nothing is added to `report.observed`!
     - Verify that ordinary JS tests without custom local worktree transforms have empty `runtimeHostModules` (`[]`) and zero extra observed paths!

4. **Tests (`test/runners/jest/warm.test.ts`, on BOTH Jest 29.7.0 and Jest 30.5.2):**
   - **Dynamic `require("./helper.cjs")` inside `getCacheKey`/`process` (matching `0.1.648.md` B1):**
     - Run 1 passes and observes `helper.cjs` (and `transform.cjs`).
     - Edit `test/a.test.js` (leaving `helper.cjs` untouched) -> `invalidate([{ path: "test/a.test.js", kind: "change" }])` -> Run 2 reuses the **same PID**, passes, and **still observes `helper.cjs`**!
     - Edit `helper.cjs` (`exports.valid = false`) -> `invalidate([{ path: "helper.cjs", kind: "change" }])` -> Run 3 recycles to a **new PID** and fails with the transform error (`edited helper rejects this source`), matching a fresh subprocess!
     - Edit `helper.cjs` back to `exports.valid = true` -> `invalidate([{ path: "helper.cjs", kind: "change" }])` -> Run 4 recycles to a **new PID**, passes, and observes `helper.cjs`!
   - **Module-scope `const helper = require("./helper.cjs")` at top of `transform.cjs`:**
     - Run 1 passes and observes `helper.cjs`.
     - Edit `helper.cjs` (`exports.valid = false`) -> `invalidate([{ path: "helper.cjs", kind: "change" }])` -> Run 2 recycles to a **new PID** and fails with the transform error!
     - Edit `helper.cjs` back to `exports.valid = true` -> `invalidate` -> Run 3 recovers cleanly and passes!
   - Keep all existing same-PID source/manual-mock edit reuse tests, RSS recycling, idle exit, K8 cancellation, and V8 coverage tests green!

### Verification

Run:
- `pnpm run lint`
- `pnpm run typecheck`
- `TMPDIR=/tmp pnpm exec vitest run test/runners/jest/warm.test.ts test/runners/jest/adapter.test.ts test/runners/jest/coverage.test.ts test/runners/jest/ts-jest-dts.test.ts test/kit/jest.test.ts`
- `TMPDIR=/tmp pnpm exec vitest run test/runners/boundaries.test.ts test/harness/shared/names-no-runner.test.ts test/keys/key-format.test.ts`
- `git diff --check`

Commit cleanly on your worker branch and report exact commands and results.
