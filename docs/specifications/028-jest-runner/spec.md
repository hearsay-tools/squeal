# 028 Jest runner

## Problem

Many TypeScript and React repositories, including `apptension/saas-boilerplate` (202 test files across 17 `@nx/jest` packages, 76% of its test files), run their JavaScript/TypeScript suites on Jest 29 or Jest 30 rather than Vitest or `node:test`. Today Squeal supports only Vitest, `node:test`, and `pytest`, so Jest projects receive no continuous background validation, no content-keyed cross-worktree reuse, and no V8 coverage tracking.

## Goals

1. **First-class `RunnerAdapter` for Jest 29 and Jest 30 (D1 to D6).** `src/runners/jest/` implements `RunnerAdapter` (`src/core/types/runner.ts`) cleanly inside its own folder, passes `test/runners/boundaries.test.ts` and `test/harness/shared/names-no-runner.test.ts`, and ships a correctness pack in `test/kit/packs/jest.ts` verified on both Jest 29.7.x and Jest 30.x.
2. **Accurate per-file closures inside Jest's VM sandbox (D3).** A Jest `runtime` subclass wrapping per-file `ScriptTransformer` captures every CJS, ESM, JSON, `moduleNameMapper`, manual mock, setup-file, and computed `require` module loaded by each test file on Jest 29 and 30. Squeal's `recorder.cjs` (with runner-neutral current-file attribution) captures `fs`, `child_process`, and `ts-jest` `.d.ts` type inputs. Cross-package edits (for example `webapp-core` -> `webapp`) select and re-run affected tests reliably.
3. **Multi-project monorepo support without Nx dependency (D1, D2).** `squeal.config.json` configures Jest projects by config path; `squeal setup` discovers project configs (expanding root `projects` configs via `readConfigs` while skipping empty root configs like `saas-boilerplate`'s `export default {}`). Direct Jest runs pass without Nx and without picking up ancestor `tsconfig.json` files under Jest 29 `ts-node`.
4. **Honest streaming results, deterministic identity, and V8 coverage (D4, D5).** A streaming Jest reporter records completed files immediately (Spec 016 Kit K8 survives mid-batch kills), disambiguates duplicate test titles via `--testLocationInResults`, reports transform/syntax/type/snapshot errors cleanly, and maps per-file V8 coverage into Spec 015 `CoverageRecord`.
5. **Fast warm execution in a later wave (D7).** Wave 1–3 ship subprocess-per-batch (~2.0 s warm per batch on `saas-boilerplate`, zero idle RAM); Wave 4 adds a recycled warm `@jest/core` `createTestScheduler` host (~0.2 s/file after 1.3 s first file) with RSS recycling and context recreation on config or file-list changes, plus Spec 026 remote-lane support.
6. **Consistent harness behavior (D6).** `src/runners/jest/describe.ts` matches `vitest`, `node:test`, and `pytest`: opt-in `testCommand.denyWhenCurrent` (default `false`), plain Jest forms only, no command rewriting, and no Nx command interception.

## Non-goals

- **Driving Jest `--watch` mode.** Research `028-01` (F2.3) confirmed `--watch` is driven by interactive keypresses and haste-map events that cannot be bound to Squeal revisions.
- **Using Jest `--findRelatedTests` for affected selection.** Research `028-01` (F3.4) proved `--findRelatedTests` takes ~1 s per project and misses setup files and every cross-package import in monorepos.
- **Intercepting Nx commands (`pnpm nx run <p>:test`, `nx affected`).** Decided 2026-11-26 (the human): Nx targets can carry `dependsOn` and custom executors; Squeal stays out of Nx command interception and never rewrites commands.
- **Supporting Jest < 29.** First release supports Jest 29.x and Jest 30.x on Node 22.19+.

## Design

### D1. Policy and project discovery

1. **Policy schema (`src/core/types/policy.ts`, `src/core/daemon/policy-jest.ts`):**
   Add top-level `jest: readonly JestProject[]` (default `[]`) beside `nodeTest` and `pytest`:
   ```ts
   export interface JestProject {
     readonly name: string;
     /** Repo-relative path to the Jest config file (or package.json with a `jest` key). */
     readonly config: string;
     /** Optional inline project selector inside a root `projects` array: unique `displayName` or `#<index>`. */
     readonly project?: string;
     /** Optional working directory; defaults to the config file's directory. */
     readonly cwd?: string;
     readonly include: readonly string[];
     readonly exclude: readonly string[];
     readonly args: readonly string[];
     readonly env: Readonly<Record<string, string>>;
     readonly slow?: boolean;
     readonly batchSize?: number;
     readonly container?: string; // optional Spec 027 container target
   }
   ```
   Project names share the repository-wide uniqueness check across all runners (`vitest`, `node-test`, `pytest`, `jest`).
2. **Discovery (`squeal setup`):**
   - Scans for `jest.config.{js,ts,mjs,cjs,json}` and `package.json` files holding a `"jest"` key (respecting `.gitignore` and `node_modules`).
   - Resolves each candidate once via Jest's `readConfigs` (`jest-config`):
     - If a root config defines a non-empty `projects` array (including `@nx/jest`'s `getJestProjectsAsync()`), `squeal setup` expands it into explicit `JestProject` entries and does not register the root wrapper as a project.
     - If a root config has no `projects` AND matches zero unique test files (or sits above nested `jest.config.*` files, as in `saas-boilerplate`'s `export default {}`), `squeal setup` skips it with a clear note rather than registering an unconfigured root catch-all.
   - Seeds each project's `name` (from Jest `displayName` or package folder name), `config`, and `cwd`.

### D2. Jest resolution, TypeScript config hygiene, and environment identity

1. **Resolving the project's Jest (`src/runners/jest/resolve.ts`):**
   - Never assumes pnpm hoists `@jest/core` or `jest-runtime`. Resolves `jest` from the project directory (then worktree root), then resolves `jest-cli` from `jest`, and `@jest/core`, `jest-config`, and `jest-runtime` from `jest-cli` (`028-01` `resolve-runtime.cjs`).
   - Supports Jest `>= 29.0.0 < 31.0.0`; older or missing installs leave project files `unknown` with one actionable install note (matching `vitest`/`pytest` no-environment honesty).
2. **Jest 29 `ts-node` trap mitigation (`028-01` F1.4):**
   - Jest 29 loads `.ts` configs via `ts-node`, which searches upward from `cwd` for `tsconfig.json` and can load an unrelated ancestor project's TypeScript compiler if the repo uses only `tsconfig.base.json`.
   - When loading a `.ts` Jest config on Jest 29 and `TS_NODE_PROJECT` is unset, Squeal sets `TS_NODE_PROJECT` to the nearest `tsconfig*.json` inside the worktree (preferring `tsconfig.spec.json` -> `tsconfig.json` -> `tsconfig.base.json`), preventing escape outside the worktree.
3. **Environment identity (`environment()`):**
   Computes a deterministic worktree-independent hash (Decision 0002) from:
   - Normalized resolved Jest config (`readConfigs` output with all absolute worktree paths rewritten as `<worktree>/...`), stripping volatile execution-only fields (`cacheDirectory`, `seed`, `maxWorkers`, `reporters`, Squeal's injected `runtime`, `watch`, `watchAll`).
   - Content hashes of the config file chain: project `jest.config.*`, `preset` file(s), `babel.config.*` / `.babelrc*` in scope, `tsconfig.spec.json` and its `extends` chain, and `setupFiles` / `setupFilesAfterEnv` files.
   - Installed package versions from the workspace lockfile / resolved `package.json` for `jest`, `jest-environment-jsdom`, `babel-jest`, `ts-jest`, `@babel/core`, `typescript`, and any configured preset/transformer packages.
   - Runtime descriptors: `process.versions.node`, `process.platform`, `process.arch`, `NODE_ENV` (normalized to `"test"` when unset, matching `jest-cli/bin/jest.js`), `BABEL_ENV`, `TZ`, `TS_NODE_*` (on Jest 29), project `args`, project `env` (template strings if D2 of Spec 027 is used), and `JEST_ADAPTER_VERSION`.

### D3. VM-sandbox module observation and closure

1. **Per-file module loads via Jest `runtime` subclass (`src/runners/jest/runtime/observe-runtime.cjs`):**
   - Exports a class extending the project's resolved `jest-runtime` default `Runtime` class (compatible with both Jest 29 and Jest 30 constructor signatures, where Jest 30 requires `globalConfig`).
   - In its constructor (which receives `testPath` and the per-test-file `ScriptTransformer`), wraps `transform`, `transformAsync`, and `transformJson` on that transformer instance to record every transformed/loaded absolute file path for `testPath`.
   - Captures CJS, ESM, JSON, `moduleNameMapper` targets, manual `__mocks__/`, `setupFiles`, `setupFilesAfterEnv`, cross-package pnpm workspace links (realpathed into `packages/`), and computed `require()` calls on both Jest 29.7 and Jest 30.5 (`028-01` F3.2).
   - Writes per-file module load lists to the batch's events file (or IPC channel in D7) so the adapter returns them in `RunReport.loaded` (feeding Spec 022 `loaded` closure strategy and core-owned `src/core/keys/observed.ts`).
2. **Runner-neutral file & spawn attribution in `src/runners/observe/recorder.cjs`:**
   - Currently `recorder.cjs` attributes `fs` and `child_process` events using `__vitest_worker__.filepath` or per-process `settings.file`.
   - Replace/extend that check with a runner-neutral global slot (for example `globalThis[Symbol.for("squeal.currentTestFile")]`, read first, keeping Vitest's fallback).
   - The Jest `runtime` subclass sets and clears this symbol around each test file's execution, allowing `recorder.cjs` (`NODE_OPTIONS=--require`) to attribute `fs.readFileSync`, `readdirSync`, spawned children, and `ts-jest` `.d.ts` type-checking reads per test file even inside multi-file `--runInBand` batches, with zero Jest name in `src/core` or `src/harness/shared` (Spec 016 D4, D5).
   - For `ts-jest` projects, `recorder.cjs` captures `.d.ts` files read during type-checking (`028-01` F3.3), guaranteeing that a breaking type edit re-keys and re-runs affected `ts-jest` tests.
3. **Pre-run static closure and `affected()`:**
   - Before a test file has ever run, `affected(changedPaths)` and initial `closure(ref)` reuse Squeal's static JS/TS import graph (`src/runners/node-test/graph/` extracted to a shared `src/runners/js-graph/` module so `test/runners/boundaries.test.ts` stays clean!), extended with:
     - `tsconfig` `paths` and `baseUrl`,
     - static `moduleNameMapper` rewrites from the resolved Jest config,
     - `setupFiles` and `setupFilesAfterEnv` closures added to every test file in that project, and
     - deterministic snapshot paths (`__snapshots__/<basename>.snap`, or skipped/observed if a custom `snapshotResolver` is configured) returned in `RunnerClosure.snapshot`.
   - Once a file has run, `RunReport.loaded` + `recorder.cjs` observed inputs refine the closure through Squeal's existing core path (Spec 011 C3, C12; Spec 016 D4).

### D4. Wave 1 execution: subprocess per batch

1. **Batching and invocation (`src/runners/jest/run/`):**
   - Splits `files` by project into batches of `batchSize` (default `5`, slow files alone), running up to `concurrency` (`runner.tierSize`) batches in parallel, each in its own process group (`startGroup` from `src/runners/process/group.ts`).
   - Generates a tiny temporary wrapper config (`<cacheDir>/wrap-<hash>.cjs`) that loads the project's real Jest config (supporting JS, CJS, MJS, TS, JSON, and async config functions) and injects `runtime: <observe-runtime.cjs>` while preserving every user option.
   - Spawns the project's Jest CLI (`node <jestBin>`) with:
     - `--config <wrapperConfig>`
     - `--runInBand` (one worker per Squeal batch, since Squeal already parallelizes across batches and `--runInBand` keeps per-file `recorder.cjs` attribution exact)
     - `--ci` (prevents accidental snapshot writes)
     - `--forceExit` (prevents open timers/handles from hanging batches past `onRunComplete`, `028-01` F4.3)
     - `--testLocationInResults` (enables deterministic duplicate-title disambiguation)
     - `--cacheDirectory <squealCacheDir>/jest/<projectHash>` (persistent content-keyed transform cache across batches, outside the worktree)
     - `--reporters <squeal-reporter.cjs>`
     - Explicit normalized test file paths (using positional paths, compatible with both Jest 29 and Jest 30, avoiding `--testPathPattern` vs `--testPathPatterns`).
   - Sets `NODE_ENV=test` if unset, `NODE_OPTIONS` with `recorder.cjs` when `observe.runtimeInputs` is on, and `TS_NODE_PROJECT` per D2.
2. **Cancellation and deadlines:**
   - On `timeoutMs` or `AbortSignal`, sends SIGTERM to the batch process group, followed by SIGKILL after 2,000 ms (`KILL_GRACE_MS`).
   - Files whose `fileResult` line is already flushed on disk are preserved (Kit K8); files with only `fileStart`/`case` lines and no `fileResult` are dropped and reported `unknown`.

### D5. Streaming reporter, check identity, failures, and V8 coverage

1. **Streaming reporter (`src/runners/jest/runtime/squeal-reporter.cjs`):**
   - Implements Jest's custom reporter interface (`onTestFileStart`, `onTestCaseResult`, `onTestFileResult`, `onRunComplete`).
   - Synchronously appends (`appendFileSync`) one JSON line per event to `<logDir>/events-<batch>.jsonl`.
   - Reads module loads recorded by `observe-runtime.cjs` for that test file and emits them inside the `fileResult` record.
2. **Check identity and outcomes:**
   - Check name: `[...ancestorTitles, title].join(" > ")` (or matching Vitest's separator convention in `src/runners/vitest/results.ts`).
   - Duplicate names in the same file are disambiguated with `(line N)` and `(line N, 2)` using `location.line` from `--testLocationInResults` (`028-01` F4.2), matching Vitest's exact rule.
   - Status mapping: `passed` -> `pass`, `failed` -> `fail`, `pending`/`todo` -> `skip` (read from `onTestFileResult.testResults` since `onTestCaseResult` is not emitted for skipped cases).
   - File-level errors: syntax errors (`BABEL_PARSE_ERROR`), load-time throws, missing `@jest-environment`, and `ts-jest` type errors arrive in `testExecError` with empty `testResults` and map to `fileErrors` (leaving known checks honestly failed/errored without losing identities).
   - Snapshot failures (`snapshot.unmatched > 0`, missing snapshots under `--ci`, obsolete keys) are surfaced in the failure summary/diagnostics.
   - Deterministic failure fingerprinting strips temp paths and ANSI codes.
3. **V8 coverage (Spec 015 integration):**
   - When coverage is enabled, passes `--coverage --coverageProvider=v8 --coverageReporters=none --coverageThreshold={}` (avoids loading an empty reporter name, writes no worktree coverage report, and prevents full-project thresholds from failing Squeal's affected batches).
   - In `onTestFileResult`, extracts `testResult.v8Coverage` (`[{ codeTransformResult, result }]`) and maps transformed V8 `ScriptCoverage` + source maps into Spec 015's relative `CoverageRecord` format (reusing Squeal's existing V8 coverage mapper).

### D6. Core seams, Spec 016 correctness kit, and opt-in command recognition

1. **Core seams (zero `RunnerAdapter` interface change):**
   - `src/core/runner-host/protocol.ts`: add `"jest"` to `HOST_RUNNERS` and `JestProject` to host start options.
   - `src/core/runner-host/runners.ts` and `proxy.ts`: wire `buildAdapter` and `hostTraits` for `"jest"`.
   - `src/core/daemon/`: register Jest runner alongside `node:test` and `pytest` (lazy/moment-aware per Spec 026 D1 so `manual` Jest groups start zero hosts on edit).
   - `src/runners/descriptions.ts`: add `JEST` to `DESCRIPTIONS`, `RunnerCoverage`, `CommandContext`, `TestCommand`.
   - `test/harness/shared/names-no-runner.test.ts`: add `jest` to the forbidden runner-name regex so `src/harness/shared/` remains runner-agnostic (Spec 016 D5).
   - `src/runners/js-graph/`: shared static JS/TS import graph used by both `node-test` and `jest`, keeping `test/runners/boundaries.test.ts` green (no runner imports another runner's folder).
2. **Spec 016 correctness kit (`test/kit/packs/jest.ts`):**
   - Runs all shared kit scenarios (K1 to K10) against `src/runners/jest/` on **both Jest 29.7.x and Jest 30.x** fixtures.
   - Any documented gap (if confirmed during implementation, such as out-of-test reads under K4) is recorded explicitly as `KNOWN` citing this spec section.
3. **Opt-in command recognition (`src/runners/jest/describe.ts`):**
   - Matches `vitest`, `node:test`, and `pytest` (`005` D8): active **only** when `testCommand.denyWhenCurrent` is `true` (default `false`), never rewrites commands, and falls through on any shell metacharacter (`| tail`, `| head`, `&&`, redirects, globs, leading `VAR=val`) via `shellWords()`.
   - Recognizes only plain direct Jest invocations: `jest`, `npx jest`, `pnpm exec jest`, and bare `npm test` / `pnpm test` when the directory's `package.json` `"test"` script is bare `jest` with no `pretest`/`posttest` scripts.
   - Recognizes only safe output flags (`--verbose`, `--silent`, `--no-color`, `--colors`) and explicit listed test files (falling through on `-t`, `--testNamePattern`, `-u`, `--updateSnapshot`, `--watch`, directories/unlisted files, or unknown flags).
   - **Never** recognizes `nx` commands (`pnpm nx run ...`, `nx affected`).

### D7. Wave 4: recycled warm Jest host (`@jest/core` `createTestScheduler`)

After Waves 1 to 3 ship and prove correctness on Jest 29, Jest 30, and `saas-boilerplate`:

1. **Warm execution inside `runner-host`:**
   - Loads project configs and builds haste maps once per worktree (`028-01` F5.1: all 17 `saas-boilerplate` projects load in 0.76 s and ~235 MB RSS, only +0.2 s / +16 MB over one project).
   - Runs batches via `@jest/core` `createTestScheduler(globalConfig, context).scheduleTests(...)` (~0.2 s per file after a 1.3 s first file, a 10x speedup over subprocess-per-batch).
2. **Memory recycling (`028-01` F2.2):**
   - Because Jest's VM contexts retain ~18 MB RSS per file (216 MB -> 746 MB over 30 runs), the warm host monitors `process.memoryUsage().rss` after every batch and recycles cleanly between batches once RSS exceeds a machine-derived ceiling (default `min(1024 MiB, 10% of host RAM)`, configurable via policy).
3. **Freshness & invalidation:**
   - Source and manual-mock edits are visible immediately on the next run (`028-01` F2.2).
   - Config edits (`jest.config.*`, `jest.preset.*`, `babel.config.*`, `tsconfig.*`), file additions/deletions, or `__mocks__/` changes clear Node's `require` cache and recreate the affected project's haste map & context (`InvalidateResult.recreatedProjects`).
4. **Idle exit & remote execution:**
   - Honors `runner.hostIdleMinutes` (Spec 021 D20) and moment-aware keying (Spec 026 D1), exiting when idle for zero resting RAM.
   - Runs unchanged over Spec 026 remote SSH/cloud lanes and Spec 027 container runner-hosts.

### D8. Proposed implementation waves

| Row | Wave | Design | Scope |
| --- | --- | --- | --- |
| 028-02 | Wave 0 | D1, D2, D6 | Shared `src/runners/js-graph/` extraction (keeping `boundaries.test.ts` green), `JestProject` policy schema/loader, Jest 29/30 resolver + `TS_NODE_PROJECT` hygiene, Jest 29 & 30 test fixtures |
| 028-03 | Wave 1 | D4, D5 | Subprocess-per-batch runner (`src/runners/jest/run/`), wrapper config generator, streaming `squeal-reporter.cjs`, check identity + `--testLocationInResults` + error/snapshot mapping, process-group cancellation |
| 028-04 | Wave 1 | D3 | `observe-runtime.cjs` (`ScriptTransformer` wrapper for Jest 29 & 30), runner-neutral current-file global in `src/runners/observe/recorder.cjs`, static `moduleNameMapper` + `tsconfig` paths + setup-file closure & `affected()` |
| 028-05 | Wave 2 | D2, D6 | `environment()` keyer, `RunnerAdapter` assembly (`src/runners/jest/adapter.ts`), `HOST_RUNNERS` / daemon wiring, and Spec 016 kit pack (`test/kit/packs/jest.ts`) passing K1–K10 on Jest 29 and 30 |
| 028-06 | Wave 3 | D1, D5, D6 | `squeal setup` Jest & multi-project/Nx discovery, `src/runners/jest/describe.ts` (opt-in plain-Jest deny + `names-no-runner.test.ts`), and V8 coverage mapping (`CoverageRecord`, Spec 015) |
| 028-07 | Wave 4 | D7 | Recycled warm `@jest/core` `createTestScheduler` host (RSS ceiling recycling, config/add/delete recreation, idle exit) + Spec 026 remote lane integration |
| 028-08 | Wave 5 | D8 | Automated E2E suite (Jest 29 + 30) and dogfooding on a throwaway copy of `saas-boilerplate` (17 projects, 202 test files, cross-package `webapp-core` -> `webapp` edits, `ts-jest` `.d.ts` re-keying, `lessons.md`) |

## Testing

- **Spec 016 shared kit (`test/kit/packs/jest.ts`):** Every scenario K1 to K10 passes on both Jest 29.7.x and Jest 30.x fixtures (cold pass, regression, recovery, runtime reads, computed requires, rename/delete, env change, mid-batch kill K8, skip preservation, child-process direct marks K10).
- **Boundaries & key validity:** `test/runners/boundaries.test.ts`, `test/harness/shared/names-no-runner.test.ts`, and `test/keys/key-format.test.ts` pass; zero key drift for existing Vitest, `node:test`, and `pytest` projects.
- **Jest-specific regressions:**
  - Jest 29 nested-worktree `TS_NODE_PROJECT` isolation (does not load parent repo TypeScript).
  - `ts-jest` `.d.ts` edit re-keys and re-runs failing/passing type-checked test.
  - Cross-package workspace import (`pkg-a` -> `pkg-b`) triggers `affected()` and re-keys cleanly.
  - Duplicate test names and `test.each` disambiguate cleanly; syntax/load/missing-env/snapshot/open-handle errors report honestly.
  - Opt-in `describe.ts` denies only verbatim plain Jest forms when `denyWhenCurrent: true`, falls through on `| tail`, `| head`, `&&`, `-t`, `-u`, and `pnpm nx run ...`.
  - Warm host (Wave 4): recycles cleanly above RSS cap, sees source/mock/config/add/delete edits without stale passes, and exits on idle.
- **Proof (Wave 5):** End-to-end suite + `saas-boilerplate` dogfooding report in `lessons.md`.

## Open questions

1. **Wave 4 warm host priority:** Should Wave 4 (warm `createTestScheduler` host) be built immediately after Waves 1–3, or ship Waves 1–3 (~2.0 s warm subprocess per batch) first and dogfood on `saas-boilerplate` before deciding whether the warm host is needed? (Owner: the human, at spec review.)
2. **Build order between Spec 027 and Spec 028:** Both specs are independent on almost every file (shared seam: `src/core/types/policy.ts` and `src/core/runner-host/`). Should we build them in sequence (which first?) or in parallel waves? (Owner: the human, at spec review.)

## References

- Research: `research/jest-runner.md` (028-01, 2026-11-26) and `research/probes/jest-runner/`.
- Related specs: `003-node-test-runner`, `005-agent-adoption` (D8), `007-pytest-runner`, `011-core` (C3, C4, C12, C14), `013-vitest-runner`, `015-coverage-complexity`, `016-extensions` (D1, D4, D5), `022-selection-strategy`, `026-tiered-and-cloud-execution`.
- Reference project: `https://github.com/apptension/saas-boilerplate` at `caa46d26`.
