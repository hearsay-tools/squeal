# 028 Jest runner: Wave 4 briefs (row 028-07, candidate 0.1.648)

Implements Spec 028 D7:
- **Worker 1 (`028-07a`):** Recycled warm `@jest/core` `createTestScheduler` child worker pool (RSS ceiling recycling, source/mock freshness, config/add/delete/touch recycling, idle exit, Kit K8 process-group cancellation, per-batch `recorder.cjs` observation reset, V8 coverage, clean fallback to subprocess-per-batch for custom `args` or `globalSetup`/`globalTeardown`).
- **Worker 2 (`028-07b`):** Spec 026 remote lane integration (`REMOTE_RUNNERS` includes `"jest"`, `createJestRunnerSet` wired with `...onRemote`, container Jest projects never sent remote).

Two workers run in parallel with strictly disjoint file ownership. Neither runs `pnpm run build` or a full test suite. Pass `TMPDIR=/tmp` when running Vitest on Jest tests so the pre-installed strict-layout Jest 29.7.0 and 30.5.2 caches under `/tmp/squeal-jest-*` are reused without installing packages; never modify those cached fixtures.

---

## Worker 1 (`028-07a`): Recycled warm `@jest/core` `createTestScheduler` worker pool

### Read first

- `docs/specifications/028-jest-runner/spec.md` (D3, D4, D5, D7)
- `docs/specifications/028-jest-runner/research/jest-runner.md` (Q2 F2.2, F2.4; Q3; Q4)
- `docs/specifications/028-jest-runner/research/probes/jest-runner/warm-host.cjs` and `warm-fresh.cjs`
- `src/runners/observe/recorder.cjs` and `src/runners/observe/spawn.cjs` and `src/runners/observe/read.ts`
- `src/runners/jest/adapter.ts`
- `src/runners/jest/run/run.ts`
- `src/runners/jest/run/wrapper-config.ts`
- `src/runners/jest/runtime/observe-runtime.cjs` and `src/runners/jest/runtime/squeal-reporter.cjs`
- `src/runners/jest/resolve.ts`
- `src/core/types/policy-jest.ts` and `src/core/daemon/policy-jest.ts`
- `test/kit/packs/jest.ts`

### File ownership (strict)

- `src/runners/observe/recorder.cjs`
- `src/runners/jest/runtime/warm-worker.cjs` (new)
- `src/runners/jest/run/warm.ts` (new)
- `src/runners/jest/run/run.ts`
- `src/runners/jest/adapter.ts`
- `src/core/types/policy-jest.ts`
- `src/core/daemon/policy-jest.ts`
- `test/runners/jest/warm.test.ts` (new)
- `test/daemon/policy-jest.test.ts`

Do not edit any other files.

### Design and requirements

1. **Runner-neutral per-batch observation reset in `src/runners/observe/recorder.cjs`:**
   - A long-lived warm worker runs multiple batches across its lifetime. Currently `recorder.cjs` keeps a `seen` Map for the lifetime of the process and writes to one fixed `settings.out` / `output` path.
   - Add one runner-neutral global hook `globalThis[Symbol.for("squeal.observeReset")] = (nextOut, nextSkip) => { ... }` inside `install(settings)` (never name `"jest"` or any runner in `recorder.cjs`, and keep `RECORDER_VERSION` at `"7"`):
     - Flushes any `pending` records to the current `output`.
     - Clears `seen` so the next batch records every `fs` / `readdir` / `spawn` / `.d.ts` access freshly for that batch's test files.
     - If `typeof nextOut === "string" && nextOut !== ""`: updates `settings.out = nextOut`, computes a fresh `output` filename in `nextOut`, and refreshes the `skip` array (keeping `nextOut` + `nextSkip` if provided, else existing `settings.skip`). Verify `spawn.cjs` reads `settings.out` dynamically when injecting `SQUEAL_OBSERVE` into spawned children (it receives the `settings` object reference; confirm `spawn.cjs` uses `settings.out` at spawn time!).
   - Keep `process.send` flushing via `wrap(process, "send", flushFirst)` (already in `recorder.cjs:330`), so when `warm-worker.cjs` calls `process.send({ type: "done", ... })`, all buffered observations are flushed to `output` before the parent receives `done`.

2. **Policy option (`src/core/types/policy-jest.ts`, `src/core/daemon/policy-jest.ts`):**
   - Add optional `readonly warmMemoryLimitMb?: number;` on `JestProject`: RSS recycling ceiling in MiB (positive integer). Absent means the machine-derived default: `Math.max(256, Math.min(1024, Math.floor(os.totalmem() / (10 * 1024 * 1024))))` MiB (`min(1024 MiB, 10% of host RAM)`, floored at 256 MiB for tiny VMs/containers).
   - Validate with `positiveInteger` in `policy-jest.ts` and add unit tests in `test/daemon/policy-jest.test.ts`.
   - Note: `warmMemoryLimitMb` does NOT change test outcomes and should NOT enter `jestEnvironment`'s `resolvedConfig` key (existing keys stay byte-identical!).

3. **Warm child worker (`src/runners/jest/runtime/warm-worker.cjs`):**
   - Plain CommonJS using Node built-ins only (`src/harness/build.ts` automatically copies every `.cjs` in `src/runners/jest/runtime/` into `<plugin>/dist/jest/`).
   - Spawned in its own detached process group (`detached: true`, `stdio: ["ignore", stdoutFd, stderrFd, "ipc"]`) with `cwd = jestCwd`, `env` carrying `NODE_ENV=test` (when unset), `TS_NODE_PROJECT` (Jest 29 hygiene), `SQUEAL_JEST_RUNTIME: install.runtime`, project `env`, `childEnv`, and `observeEnv(...)` when observing.
   - Startup `init` IPC message: `{ type: "init", cwd, wrapperPath, cacheDir, coreDir, configDir, runtimeDir, reporterPath, coverage }`:
     - Calls `fs.mkdirSync(cacheDir, { recursive: true })` BEFORE building `HasteMap`.
     - Loads `@jest/core` from `coreDir`, `jest-config` (`readConfigs`) from `configDir`, `jest-runtime` from `runtimeDir`.
     - Builds `argv` with:
       - `$0: "jest"`, `_: []`, `config: wrapperPath`, `cacheDirectory: cacheDir`,
       - `runInBand: true`, `ci: true`, `silent: true`, `watchman: false`, `testLocationInResults: true`,
       - `reporters: [reporterPath]`,
       - When `coverage === true`: `coverage: true`, `coverageProvider: "v8"`, `coverageReporters: ["none"]`, `coverageThreshold: "{}"`.
     - Calls `readConfigs(argv, [cwd])` (note: pass absolute `[cwd]` per research `028-01` F2.2!). Note: for an inline project wrapper returning `{ ...root, rootDir, projects: [{ ...selected, runtime }] }`, `configs` has length 1 (`configs[0]`).
     - Builds `HasteMap` once: `const hasteMap = await Runtime.createHasteMap(config, { maxWorkers: 1, resetCache: false, watch: false, watchman: false })`; `const { hasteFS, moduleMap } = await hasteMap.build()`; `ctx = { config, hasteFS, moduleMap, resolver: Runtime.createResolver(config, moduleMap) }`.
     - Replies `{ type: "ready", pid: process.pid, rssBytes: process.memoryUsage().rss }`.
   - Per-batch `run` IPC message: `{ type: "run", id, files, eventsFile, coverageDir, observeOut, observeSkip }`:
     - Calls `globalThis[Symbol.for("squeal.observeReset")]?.(observeOut, observeSkip)` when `observeOut` is set.
     - Sets `process.env.SQUEAL_JEST_EVENTS = eventsFile`.
     - Sets or deletes `process.env.SQUEAL_JEST_COVERAGE_DIR` (`coverageDir ?? ""`).
     - Calls `const scheduler = await core.createTestScheduler(globalConfig, { firstRun, previousSuccess: true })` (setting `firstRun = false` after the first batch).
     - Calls `await scheduler.scheduleTests(files.map((file) => ({ context: ctx, path: file })), { isInterrupted: () => false, setState() {} })`.
     - Replies `{ type: "done", id, rssBytes: process.memoryUsage().rss }` (or `{ type: "error", id, message }` on unexpected throw, then exits non-zero).
   - Graceful `shutdown` IPC message: closes cleanly (`process.exit(0)`).
   - If the IPC channel disconnects (`process.on("disconnect", ...)`): exit immediately so no orphan worker survives parent death!

4. **Warm worker pool (`src/runners/jest/run/warm.ts`) & `runJest` / `adapter.ts` wiring:**
   - Export `defaultWarmMemoryLimitBytes()` (`min(1024 MiB, 10% of host RAM)`, floor `256 MiB`) and `JestWarmPool` (manage pooled warm workers for one `JestProject`, up to `concurrency` workers, keyed by immutable startup signature: `wrapperPath`, `observing`, `covering`, `envSignature`, `cwd`).
   - **When to use warm pool vs subprocess-per-batch (`runJest`):**
     - Use the warm pool when:
       - `warmPool` is passed, AND
       - `project.args.length === 0`, AND
       - `hasGlobalHooks` is `false` (`read.global.globalSetup == null && read.global.globalTeardown == null`), AND
       - `project.env` has no `{slot}` / `{slot0}` / `{worktreeSlot}` templates and `project.slots` is unset (so Spec 027 slot-templated projects keep per-batch slot expansion cleanly without extra complexity).
     - Otherwise run the existing subprocess-per-batch `runJest` path unchanged.
   - **Recycling & lifecycle:**
     - **RSS ceiling (D7.2):** After every batch completes, inspect `rssBytes`. If `rssBytes > memoryLimitBytes`, shut down that worker cleanly (`shutdown` -> fallback SIGTERM/SIGKILL) and drop it from the pool so the next batch spawns a fresh worker!
     - **Invalidation (D7.3):**
       - In `adapter.ts`'s `invalidate(changed)`:
         - On `reopen()` (config chain changed, `observe` toggled, or recovery from unavailable), or `coverage.changed()`, or any `changed.some((p) => p.kind === "add" || p.kind === "delete" || p.kind === "touch")`: call `await warmPool.recycle()` (closes all idle/existing workers so next run builds a fresh config & HasteMap!).
         - On ordinary `kind: "change"` to non-config-chain source/test/manual-mock files: keep the warm workers alive!
     - **Idle exit (D7.4):**
       - Each idle warm worker arms an `unref()`'d timer (`warmIdleMs`, default `60_000` ms, configurable in `JestAdapterOptions` for fast tests) that shuts down the worker cleanly when idle, for zero resting RAM.
       - `adapter.close()` awaits `warmPool.close()`, terminating all warm worker process groups cleanly.
     - **Cancellation & timeout (Kit K8):**
       - On `timeoutMs` or `AbortSignal`, snapshot `batch.cut ??= sizeOf(batch.events)`, send `SIGTERM` to the running warm worker's process group (`-pid`), `SIGKILL` after `KILL_GRACE_MS` (2,000 ms), remove that worker from the pool, and parse events up to `batch.cut` so every completed file before the signal is preserved and any cut file reports `unknown`.
     - **Crash recovery:**
       - If a warm worker exits unexpectedly mid-batch, drop it from the pool, keep any files that already flushed `fileResult`, and mark unfinished files as crashed/unfinished honestly (just like subprocess exit).
   - **Check `adapter.ts` & `run.ts`:**
     - Pass `hasGlobalHooks: read.global.globalSetup != null || read.global.globalTeardown != null` (from `state.read`) so `globalSetup`/`globalTeardown` projects cleanly take the subprocess path and never lose global hooks!
     - Ensure `test/kit/jest.test.ts` (K1–K10) passes on BOTH Jest 29.7.0 and Jest 30.5.2 with the warm pool active by default!

5. **Tests (`test/runners/jest/warm.test.ts` on BOTH Jest 29.7.0 and Jest 30.5.2):**
   - **Reuse:** Two consecutive `adapter.run()` calls reuse the same warm worker PID (expose or read worker PID via run log `run.json` or test hook) and the second run is faster / warm.
   - **Source & manual-mock freshness:** Editing a source file (`kind: "change"`) and editing a manual `__mocks__/` file (`kind: "change"`) are seen immediately on the next run WITHOUT recycling the warm worker (same worker PID!).
   - **RSS ceiling recycling:** With a tiny `warmMemoryLimitBytes` (or `warmMemoryLimitMb: 1`), after batch 1 completes the warm worker is recycled and batch 2 runs in a NEW worker PID!
   - **Invalidation recycling:** Editing `jest.config.*`, adding a file (`kind: "add"`), deleting a file (`kind: "delete"`), or `kind: "touch"` recycles the warm worker (new PID) and sees the added/changed files without stale passes.
   - **Idle exit & `close()`:** With a short `warmIdleMs` (e.g. `150` ms), the warm worker exits on its own (`process.kill(pid, 0)` throws `ESRCH`), and `adapter.close()` kills active/idle warm workers with zero leftover processes.
   - **Kit K8 cancellation:** Killing/aborting mid-batch on a slow/hanging file preserves completed files before the cut and removes the killed warm worker cleanly; a subsequent run spawns a fresh warm worker and passes.
   - **Per-batch observation (`recorder.cjs` reset):** On Run 1 AND Run 2 of the SAME test file in the SAME warm worker PID, `fs.readFileSync` and child-process reads are STILL reported in `report.observed` on Run 2 (proving `seen` was reset cleanly and `settings.out` updated!).
   - **V8 coverage & inline projects on warm worker:** Coverage records map cleanly on warm runs, and an inline multi-project (`project: "unit"`) runs cleanly on the warm worker.
   - **Fallback:** When `project.args` is non-empty or root `globalSetup` is configured, execution falls back cleanly to subprocess-per-batch and passes.

### Verification

Run:
- `pnpm run lint`
- `pnpm run typecheck`
- `TMPDIR=/tmp pnpm exec vitest run test/daemon/policy-jest.test.ts test/runners/jest/warm.test.ts test/runners/jest/adapter.test.ts test/runners/jest/coverage.test.ts test/runners/jest/ts-jest-dts.test.ts test/kit/jest.test.ts`
- `TMPDIR=/tmp pnpm exec vitest run test/runners/boundaries.test.ts test/harness/shared/names-no-runner.test.ts test/keys/key-format.test.ts`
- `git diff --check`

Commit cleanly on your worker branch and report exact commands and results.

---

## Worker 2 (`028-07b`): Spec 026 remote lane integration for Jest

### Read first

- `docs/specifications/028-jest-runner/spec.md` (D7.4)
- `src/core/runner-host/remote/settings.ts`
- `src/core/runner-host/remote/connect.ts`
- `src/core/daemon/jest-runners.ts`
- `src/core/daemon/pytest-runners.ts`
- `src/core/daemon/node-test-runners.ts`
- `src/core/daemon/daemon.ts` (around lines 1070–1130)
- `test/runner-host/remote/share-fixture.ts`
- `test/runner-host/remote/machine-share.test.ts` (for how remote lane tests work)
- `test/runner-host/remote/settings.test.ts` (check exact test files in `test/runner-host/remote/`)

### File ownership (strict)

- `src/core/runner-host/remote/settings.ts`
- `src/core/runner-host/remote/connect.ts`
- `src/core/daemon/jest-runners.ts`
- `src/core/daemon/daemon.ts`
- `test/runner-host/remote/share-fixture.ts`
- `test/runner-host/remote/jest-remote.test.ts` (new)

Do not edit any other files (in particular do NOT touch `src/core/runner-host/remote/lane.ts`, `daemon-lane.ts`, `lane-repository.ts`, `admission.ts`, or `src/core/types/policy.ts` — peer coordinators own edits there).

### Design and requirements

1. **Remote runner list (`src/core/runner-host/remote/settings.ts`, `connect.ts`):**
   - Add `"jest"` to `REMOTE_RUNNERS`: `export const REMOTE_RUNNERS = ["vitest", "node-test", "pytest", "jest"] as const;`.
   - Check `settings.ts` validation (`"all"` automatically expands `REMOTE_RUNNERS`, and explicit `["jest"]` or `"jest"` is now accepted). Check if any existing test in `test/runner-host/remote/` hardcodes the list of `REMOTE_RUNNERS` or error text; if any test outside your ownership fails because of the error text, report it immediately to the coordinator (or check via grep first!).
   - Update the JSDoc comment in `src/core/runner-host/remote/connect.ts:103` (remove "Jest joins in spec 028 D7").
   - Verify `remoteAdapterOptions` and `withoutCoverage` in `connect.ts` handle Jest's `HostAdapterOptions` (`process: { project, tempDir, cacheDir, coverage }`) identically to `node-test` and `pytest`:
     - `tempDir` moves to `<tree>/tmp`,
     - `cacheDir` moves to `<tree>/cache/<basename>`,
     - when remote `coverage` is `"off"`, `withoutCoverage` strips `process.coverage`; when `"remote"`, `process.coverage: true` is kept so remote Jest collects and returns coverage records!

2. **Daemon remote wiring (`src/core/daemon/jest-runners.ts`, `src/core/daemon/daemon.ts`):**
   - In `src/core/daemon/jest-runners.ts`:
     - Import `type RemoteWrap` from `./node-test-runners.js`.
     - Add optional `readonly remote?: RemoteWrap;` to `JestRunnersOptions`.
     - Update the JSDoc on `createJestRunners` (remove "No remote lane yet").
     - Keep `if (project.container !== undefined)` returning `createContainerGuardRunner(...)` BEFORE any remote wrapping (Spec 027 D4.2: a container project NEVER runs on the host or remotely!).
     - For non-container Jest projects, when `options.remote !== undefined`, wrap `runner` with `options.remote({ runner: "jest", name: \`jest ${project.name}\`, local: runner, start: { ... } })`, passing the same `options`, `policy`, `note`, and `coverage` (`options.coverage?.collected`) that `createHostedJest` passes! (Mirror `src/core/daemon/node-test-runners.ts` for `coverage` + `observe` and `src/core/daemon/pytest-runners.ts` for `cacheDir`!)
   - In `src/core/daemon/daemon.ts`:
     - Pass `...onRemote` into `createJestRunnerSet(...)` right beside `...inContainers` (matching `pytestRunners` directly above it).

3. **Tests (`test/runner-host/remote/share-fixture.ts`, `test/runner-host/remote/jest-remote.test.ts`):**
   - Update `PROJECTS` in `test/runner-host/remote/share-fixture.ts` to include `jest: "jest"`.
   - Write `test/runner-host/remote/jest-remote.test.ts` testing:
     - `loadRemoteSettings` accepts `runners: ["jest"]`, `runner: "jest"`, and `runners: "all"` (containing `"jest"`).
     - `remoteAdapterOptions` rewrites Jest `tempDir` / `cacheDir` under `<tree>/tmp` and `<tree>/cache/<id>`, and strips/preserves `process.coverage` per remote coverage mode.
     - `createJestRunners` with `remote` wraps ordinary Jest projects with `runner: "jest"` and passes `observe`, `coverage`, `tierSize`, `tempDir`, `cacheDir`; leaves `project.container !== undefined` projects off the remote lane!
     - End-to-end in-process remote `createTreeHost` + `remoteHostOver` + `createJestAdapter` on real Jest (29 and 30, reusing `/tmp/squeal-jest-*` via `TMPDIR=/tmp`) proving a Jest project executes over the remote tree host with matching environment keys, observed loads, and remote coverage (when enabled), AND verifying `whenLost: "local"` fallback and `whenLost: "not-run"` honesty when the remote channel drops!

### Verification

Run:
- `pnpm run lint`
- `pnpm run typecheck`
- `TMPDIR=/tmp pnpm exec vitest run test/runner-host/remote/jest-remote.test.ts test/runner-host/remote/settings.test.ts test/runner-host/remote/connect.test.ts test/runner-host/remote/machine-share.test.ts test/runner-host/remote/daemon-lane-shutdown.test.ts` (check exact filenames under `test/runner-host/remote/`!)
- `git diff --check`

Commit cleanly on your worker branch and report exact commands and results.
