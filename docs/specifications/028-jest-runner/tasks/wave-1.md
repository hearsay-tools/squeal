# Spec 028 Wave 1: Subprocess Jest runner, streaming reporter, VM runtime observer, and static closure

Reads before starting: `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/028-jest-runner/spec.md` (D3, D4, D5), `docs/specifications/028-jest-runner/research/jest-runner.md`, `src/runners/jest/resolve.ts`, `test/helpers/jest-env.ts`.

Hard rules for both rows:
- Stay strictly inside your file ownership below; rows `027-04`, `027-05`, `028-03`, and `028-04` run in parallel on the same baseline.
- Do NOT create `src/runners/jest/adapter.ts` yet (`028-05` adds it alongside `test/kit/packs/jest.ts` so `test/runners/boundaries.test.ts` stays green).
- Never import from `src/runners/node-test/`, `src/runners/vitest/`, or `src/runners/pytest/` (`test/runners/boundaries.test.ts` forbids runner-to-runner imports; use `src/runners/js-graph/`, `src/runners/observe/`, `src/runners/process/`, `src/runners/focus.ts`, `src/runners/log-dir.ts`).
- Do not run `pnpm run build`, and do not edit `package.json`, `install.sh`, `plugins/`, or `docs/board.md`.
- Do not bump `KEY_FORMAT_VERSION`, any adapter version, or `RECORDER_VERSION`.
- Verify `pnpm exec vitest run test/runners/boundaries.test.ts test/harness/shared/names-no-runner.test.ts test/keys/key-format.test.ts` plus your targeted tests, `pnpm run lint`, and `pnpm run typecheck`.
- Never run a full test suite. Never commit absolute home paths or private names. Never use em-dashes in docs or comments.

---

## Shared contract between rows 028-03 and 028-04

Both rows run in parallel and connect cleanly without overlapping files:
1. **`Symbol.for("squeal.currentTestFile")`:** `observe-runtime.cjs` (`028-04`) sets `globalThis[Symbol.for("squeal.currentTestFile")]` to the current test file's absolute path while loading and executing it, restoring the previous value in `finally`. `src/runners/observe/recorder.cjs` (`028-04`) reads `globalThis[Symbol.for("squeal.currentTestFile")]` before `globalThis.__vitest_worker__?.filepath`.
2. **`Symbol.for("squeal.jestLoaded")`:** `observe-runtime.cjs` (`028-04`) stores per-file observed module paths in `globalThis[Symbol.for("squeal.jestLoaded")]` as a `Map<string, Set<string>>` (mapping `testPath` -> `Set<absolutePath>`). `squeal-reporter.cjs` (`028-03`) reads and deletes `globalThis[Symbol.for("squeal.jestLoaded")]?.get(testResult.testFilePath)` inside `onTestFileResult` and writes `loaded: [...]` in the `fileResult` JSON line.
3. **`SQUEAL_JEST_RUNTIME` env var:** Absolute path to the resolved `jest-runtime` package folder (`install.runtime` from `resolveJest()`). `runJest` (`028-03`) passes this env var whenever injecting `observe-runtime.cjs`, and `observe-runtime.cjs` (`028-04`) resolves the project's `jest-runtime` from `process.env.SQUEAL_JEST_RUNTIME` so strict pnpm without hoisting always works.
4. **`SQUEAL_JEST_EVENTS` env var:** Absolute path to `<logDir>/events-<batch>.jsonl` written synchronously (`appendFileSync`) by `squeal-reporter.cjs` (`028-03`).

---

## Row 028-03: Subprocess-per-batch Jest runner and streaming reporter (D4, D5)

**Goal:** Implement subprocess-per-batch execution of Jest 29 and Jest 30 test files with a wrapper config generator, streaming custom reporter, deterministic check identity and error/snapshot mapping, slot allocation, and process-group cancellation preserving flushed file completions (Kit K8).

**File ownership (strictly disjoint):**
- `src/runners/jest/runtime/squeal-reporter.cjs` (new)
- `src/runners/jest/run/wrapper-config.ts` (new)
- `src/runners/jest/run/events.ts` (new)
- `src/runners/jest/run/results.ts` (new)
- `src/runners/jest/run/run.ts` (new)
- `src/runners/jest/run/index.ts` (new)
- `test/runners/jest/run/results.test.ts` (new)
- `test/runners/jest/run/run.test.ts` (new)

**Requirements:**
1. **Streaming reporter (`src/runners/jest/runtime/squeal-reporter.cjs`):**
   - Plain CommonJS using only Node built-ins (no TypeScript, no external deps).
   - Implements `onTestFileStart`, `onTestCaseResult`, `onTestFileResult`, `onRunComplete`.
   - Appends one JSON line synchronously (`fs.appendFileSync`) per event to `process.env.SQUEAL_JEST_EVENTS`:
     - `fileStart`: `{ type: "fileStart", testFilePath }`
     - `case`: `{ type: "case", testFilePath, title, ancestorTitles, fullName, status, duration, location, failureMessages, failureDetails }`
     - `fileResult`: `{ type: "fileResult", testFilePath, durationMs, testResults: [...], testExecError: ... | null, failureMessage: ... | null, snapshot: { added, fileDeleted, matched, unchecked, uncheckedKeys, unmatched, updated }, loaded: [...] }` (reading and clearing `globalThis[Symbol.for("squeal.jestLoaded")]?.get(testResult.testFilePath)`).
     - `runComplete`: `{ type: "runComplete", success, numFailedTestSuites, numPassedTestSuites }`
2. **Wrapper config generator (`src/runners/jest/run/wrapper-config.ts`):**
   - Generates `<cacheDir>/wrap-<hash>.cjs` that loads the project's real Jest config (supporting `.js`, `.cjs`, `.mjs`, `.ts`, `.json`, `package.json` `"jest"` key, sync or async config functions) and injects `runtime` when `observeRuntimePath` is provided (checking `existsSync(observeRuntimePath)` so `028-03` tests work standalone before `028-04` merges and automatically enable runtime observation once `observe-runtime.cjs` is present).
   - Preserves every other option from the user's Jest config (including `rootDir`, normalizing `rootDir` relative to the original config's directory so moving the wrapper into `<cacheDir>` never shifts `<rootDir>`!).
   - Also handles Jest 29/30 config loading cleanly (remember `jest-config`'s `readConfig` / `require` for `.ts` configs: when the project config is `.ts`, either wrap via `jest-config` or delegate cleanly — test on both Jest 29 and Jest 30!).
3. **Check identity, outcomes, errors, and snapshots (`src/runners/jest/run/results.ts`):**
   - Check name: `[...ancestorTitles, title].join(" > ")` (matching Vitest's separator).
   - Duplicate names in one file disambiguated with `(line N)` and `(line N, 2)` using `location.line` from `--testLocationInResults` (matching `src/runners/vitest/results.ts`).
   - Outcome mapping: `passed` -> `pass`, `failed` -> `fail`, `pending` / `todo` -> `skip` (read from `fileResult.testResults`, because Jest does not call `onTestCaseResult` for skipped/todo tests).
   - File-level errors: `testExecError` (syntax errors, load-time throws, missing `@jest-environment`, `ts-jest` type errors) maps to `fileErrors` with relativized paths and stripped ANSI codes.
   - Snapshot failures: `snapshot.unmatched > 0`, missing snapshots under `--ci`, or obsolete keys (`snapshot.unchecked > 0`) surface clearly in error messages/file errors.
   - Strip ANSI escape codes and temp/absolute worktree paths via `WorktreePaths` for deterministic failure fingerprints.
4. **Subprocess-per-batch runner (`src/runners/jest/run/run.ts`):**
   - Splits `files` into batches of `batchSize` (default `5`, `alone` files in batches of 1), running up to `concurrency` batches in parallel via `startGroup` (`src/runners/process/group.ts`).
   - Acquires per-batch slot from `slotPool(root, project.name, project.slots?.max)` and expands `project.env` templates + `slotVariables` cleanly before `childEnv` overlay (matching Spec 027 D1/D2).
   - Spawns `process.execPath` (`node`) with `[install.bin, "--config", wrapperPath, "--runInBand", "--ci", "--forceExit", "--testLocationInResults", "--cacheDirectory", jestCacheDir, "--reporters", reporterPath, ...project.args, ...normalizedPositionalFiles]`.
   - Sets `NODE_ENV: env.NODE_ENV ?? "test"`, merges `tsNodeHygiene(install.major, configAbs, root, env)`, sets `SQUEAL_JEST_EVENTS`, `SQUEAL_JEST_RUNTIME: install.runtime`, and optionally wires `observeEnv` from `src/runners/observe/runtime.ts` when `observe` is enabled.
   - Cancellation & deadlines: on `timeoutMs` or `AbortSignal`, sends SIGTERM to each running process group, then SIGKILL after 2,000 ms (`KILL_GRACE_MS`). Preserves files whose `fileResult` event was already flushed on disk (Kit K8) and drops files with only `fileStart`/`case` lines!
   - Guard log dir with `markLogDir` / `logGoneReport` (matching `pytest/run/run.ts`).
   - Resolve `squeal-reporter.cjs` relative to `import.meta.url` trying `../jest/` (bundled) and `../runtime/` (source), matching `pytestRuntimeDir`.
5. **Tests (`test/runners/jest/run/results.test.ts`, `test/runners/jest/run/run.test.ts`):**
   - Use `test/helpers/jest-env.ts` to run real Jest 29.7.0 AND Jest 30.5.2 fixtures!
   - Cover: pass/fail/skip/todo, duplicate test names + `test.each` line disambiguation, syntax error + load-time throw + snapshot mismatch under `--ci`, slot env expansion, and mid-batch `AbortSignal` kill preserving already-completed files while dropping the interrupted file (Kit K8).
   - Run `pnpm exec vitest run test/runners/jest/run/results.test.ts test/runners/jest/run/run.test.ts test/runners/boundaries.test.ts test/harness/shared/names-no-runner.test.ts test/keys/key-format.test.ts` and `pnpm run lint && pnpm run typecheck`.

---

## Row 028-04: Jest VM runtime observer, runner-neutral recorder attribution, and static closure (D3)

**Goal:** Capture exact per-file module loads inside Jest 29 and Jest 30's VM sandbox, enable runner-neutral per-file `fs`/spawn/`.d.ts` attribution in `recorder.cjs`, and build Jest's pre-run static closure and `affected()` over shared `src/runners/js-graph/`.

**File ownership (strictly disjoint):**
- `src/runners/observe/recorder.cjs`
- `src/runners/jest/runtime/observe-runtime.cjs` (new)
- `src/runners/jest/graph/mapper.ts` (new)
- `src/runners/jest/graph/snapshots.ts` (new)
- `src/runners/jest/graph/index.ts` (new)
- `test/runners/jest/runtime/observe-runtime.test.ts` (new)
- `test/runners/jest/graph/graph.test.ts` (new)

**Requirements:**
1. **Runner-neutral current-file global (`src/runners/observe/recorder.cjs`):**
   - Read `globalThis[Symbol.for("squeal.currentTestFile")]` FIRST in `current()`, falling back to `globalThis.__vitest_worker__?.filepath ?? settings.file ?? threadFile()`.
   - Do NOT bump `RECORDER_VERSION`! Verify `test/keys/key-format.test.ts` passes 12/12 locally with zero uncovered lines and zero differing outputs.
   - Keep `src/harness/shared/` and `src/core/` completely free of Jest names (`test/harness/shared/names-no-runner.test.ts`).
2. **Jest VM `runtime` subclass (`src/runners/jest/runtime/observe-runtime.cjs`):**
   - Plain CommonJS using only Node built-ins + resolving the project's `jest-runtime` from `process.env.SQUEAL_JEST_RUNTIME` (with fallback `require.resolve("jest-runtime")` if unset) so pnpm non-hoisted installs always resolve the exact project `jest-runtime`.
   - Subclasses `jest-runtime`'s default `Runtime` export cleanly on BOTH Jest 29 and Jest 30 (note Jest 30 constructor signature passes `globalConfig`; forward `...args` cleanly and inspect arguments safely).
   - In the constructor (which receives `testPath` and the per-file `ScriptTransformer`), wraps `transform`, `transformAsync`, and `transformJson` (and `requireModule` / `_loadModule` or resolver hooks as needed to catch JSON/untransformed CJS/ESM/manual mocks/setup files/computed `require()`) to record every resolved absolute file path under the worktree (also resolving symlinks via `realpathSync` so pnpm workspace links record their real `packages/...` target!).
   - Stores observed paths in `globalThis[Symbol.for("squeal.jestLoaded")]` (`Map<string, Set<string>>` keyed by `testPath`), AND if `process.env.SQUEAL_JEST_LOADED_OUT` is set (useful for standalone tests), also supports flushing/reading cleanly.
   - Sets `globalThis[Symbol.for("squeal.currentTestFile")] = testPath` while executing/loading the test file (for example around `requireModule` / `requireModuleOrMock` / `unstable_importModule` when entering the test file and setup files, and clearing/restoring in `finally` or `teardown()`), so `recorder.cjs` attributes `fs.readFileSync`, `readdirSync`, spawned child processes, and `ts-jest` `.d.ts` reads to the exact `testPath` even across multiple files in `--runInBand`!
   - Also check `research/probes/jest-runner/` for the verified Jest 29/30 probe patterns from `028-01`.
3. **Static closure & `affected()` (`src/runners/jest/graph/`):**
   - **`mapper.ts`:** Static `moduleNameMapper` rewriter taking Jest's `[pattern, replacement | replacement[]]` pairs and `rootDir`, expanding `<rootDir>`, regex capture groups `$1`..`$9`, and returning candidate resolved paths for static graph resolution (skipping unparseable regexes or dynamic patterns safely).
   - **`snapshots.ts`:** Computes default snapshot path (`<dir>/__snapshots__/<basename>.snap`) relative to worktree root when `snapshotResolver` is unset, or returns `null` when a custom `snapshotResolver` is configured (relying on `recorder.cjs` runtime observation).
   - **`index.ts`:** `createJestGraph(options)` built on `src/runners/js-graph/` (NEVER importing `src/runners/node-test/`!), incorporating:
     - `tsconfig` `paths` and `baseUrl`,
     - static `moduleNameMapper` rewrites from the resolved Jest config,
     - `setupFiles` and `setupFilesAfterEnv` transitive closures added to every test file in that project,
     - `affected(changedPaths)` returning `{ direct, transitive }`,
     - `closure(testFile)` returning `{ testFile, paths, packages, snapshot }`,
     - `invalidate(paths)` and `setTestFiles(files)`.
4. **Tests (`test/runners/jest/runtime/observe-runtime.test.ts`, `test/runners/jest/graph/graph.test.ts`):**
   - Run real Jest 29.7.0 AND Jest 30.5.2 fixtures (`test/helpers/jest-env.ts`) with `runtime: observe-runtime.cjs` and `observeEnv` (`recorder.cjs`):
     - Verify per-file module observation captures CJS, ESM, JSON, `moduleNameMapper`, manual `__mocks__/`, `setupFiles`, `setupFilesAfterEnv`, symlinked workspace packages, and computed `require()`.
     - Verify two test files in one `--runInBand` Jest run each get ONLY their own `fs.readFileSync` and spawned child process attributed via `Symbol.for("squeal.currentTestFile")` in `recorder.cjs`!
   - Verify `createJestGraph` covers `moduleNameMapper`, `tsconfig` `paths`/`baseUrl`, cross-package imports (`pkg-a` -> `pkg-b`), `setupFiles`/`setupFilesAfterEnv` propagation, and default vs custom `snapshotResolver` snapshot paths.
   - Run `pnpm exec vitest run test/runners/jest/runtime/observe-runtime.test.ts test/runners/jest/graph/graph.test.ts test/runners/boundaries.test.ts test/harness/shared/names-no-runner.test.ts test/keys/key-format.test.ts` and `pnpm run lint && pnpm run typecheck`.
