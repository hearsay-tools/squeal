# Spec 028 Wave 2: Jest environment keyer, RunnerAdapter, host/policy wiring, and Spec 016 kit pack

Reads before starting: `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/028-jest-runner/spec.md` (D1, D2, D6), `docs/specifications/028-jest-runner/research/jest-runner.md`, `src/runners/jest/resolve.ts`, `src/runners/jest/run/run.ts`, `src/runners/jest/graph/index.ts`, `test/kit/packs/node-test.ts`, `test/kit/packs/pytest.ts`, `test/runners/boundaries.test.ts`.

Hard rules:
- Stay strictly inside your file ownership below; row `027-06` runs in parallel on the same baseline and owns `src/core/daemon/daemon.ts`, `src/core/daemon/container-guard.ts`, `src/core/daemon/node-test-runners.ts`, `src/core/daemon/pytest-runners.ts`, `src/core/runner-host/container/`, `src/core/status/`, and `src/core/ps/`.
- Do NOT touch `src/core/daemon/daemon.ts` in this worker (the coordinator wires `createJestRunnerSet` into `daemon.ts` at integration once `027-06` and `028-05` merge!).
- Never import from `src/runners/node-test/`, `src/runners/vitest/`, or `src/runners/pytest/` (`test/runners/boundaries.test.ts` forbids runner-to-runner imports!).
- Do not run `pnpm run build`, and do not edit `package.json`, `install.sh`, `plugins/`, or `docs/board.md`.
- Do not bump `KEY_FORMAT_VERSION`, `VITEST_ADAPTER_VERSION`, `NODE_TEST_ADAPTER_VERSION`, `PYTEST_ADAPTER_VERSION`, or `RECORDER_VERSION`. Verify `test/keys/key-format.test.ts` passes 12/12 locally (zero uncovered lines, zero key drift for existing runners!).
- Do not set timers waiting on a large Squeal background backlog; read `squeal status --wait 60000` once and report any remaining pending count honestly.
- Helpful context: pre-installed strict-layout Jest fixtures are available under `/tmp` (`/tmp/squeal-jest-29-2754338cf9ef` and `/tmp/squeal-jest-30-b9e0c22dec2f`; `test/helpers/jest-env.ts` also works offline from pnpm store).
- Never run a full test suite. Never commit absolute home paths or private names. Never use em-dashes in docs or comments.

---

## Row 028-05: Jest `environment()`, `RunnerAdapter`, host/policy wiring, and Spec 016 kit pack (D2, D6)

**Goal:** Assemble the complete Jest `RunnerAdapter` (`src/runners/jest/adapter.ts`) with worktree-independent `environment()` keying, register `"jest"` in policy loading, runner-host protocol/build/proxy, and plugin build runtime copying, and ship the Spec 016 correctness kit pack (`test/kit/packs/jest.ts` + `test/kit/jest.test.ts`) passing K1–K10 on BOTH Jest 29.7.0 and Jest 30.5.2.

**File ownership (strictly disjoint from row `027-06`):**
- `src/runners/jest/version.ts` (new)
- `src/runners/jest/environment.ts` (new)
- `src/runners/jest/traits.ts` (new)
- `src/runners/jest/enumerate.ts` (new)
- `src/runners/jest/adapter.ts` (new)
- `src/runners/jest/index.ts` (new)
- `src/core/types/policy.ts`
- `src/core/daemon/policy.ts`
- `src/core/daemon/policy-containers.ts`
- `src/core/daemon/jest-runners.ts` (new)
- `src/core/runner-host/protocol.ts`
- `src/core/runner-host/runners.ts`
- `src/core/runner-host/proxy.ts`
- `src/core/runner-host/process-host.ts`
- `src/harness/build.ts`
- `test/kit/packs/jest.ts` (new)
- `test/kit/jest.test.ts` (new)
- `test/runners/jest/environment.test.ts` (new)
- `test/runners/jest/adapter.test.ts` (new)
- `test/daemon/policy.test.ts`
- `test/types.test.ts`
- `test/keys/validity/cases/policy-jest.ts` (new, if needed for `key-format.test.ts` coverage of `policy.ts` / `policy-containers.ts`)
- `test/keys/validity/cases/index.ts` (only to register `policy-jest.ts` if added)

**Requirements:**
1. **Adapter version (`src/runners/jest/version.ts`):**
   - Export `export const JEST_ADAPTER_VERSION = "1";` (and nothing else, matching `src/runners/{vitest,node-test,pytest}/version.ts`).
2. **Worktree-independent environment keyer (`src/runners/jest/environment.ts`, Spec 028 D2.3):**
   - Load the project's resolved Jest config via the project's own `jest-config` (`readConfig` / `readInitialOptions`, with `tsNodeHygiene` on Jest 29) and normalize all absolute worktree paths to `<worktree>/...` (matching `pytest/environment/hash.ts` portable path rule so two worktrees with identical code and packages compute identical environment keys!).
   - Strip volatile execution-only fields (`cacheDirectory`, `seed`, `maxWorkers`, `reporters`, Squeal's injected `runtime`, `watch`, `watchAll`).
   - Collect watched config-chain files (`files` on `RunnerEnvironment`): project `jest.config.*`, resolved `preset` file(s) inside worktree, `babel.config.*` / `.babelrc*` in scope, `tsconfig*.json` and its `extends` chain, and `setupFiles` / `setupFilesAfterEnv` files inside worktree.
   - Collect installed package descriptors (`packages` or hashed package versions from resolved `package.json`): `jest`, `jest-environment-jsdom`, `babel-jest`, `ts-jest`, `@babel/core`, `typescript`, and any configured preset/transformer packages.
   - Include `NODE_ENV` (normalized to `"test"` when unset), `BABEL_ENV`, `TZ`, `TS_NODE_*` (on Jest 29), `project.args`, unexpanded `project.env` (never expanded slot values!), and `JEST_ADAPTER_VERSION` + `RECORDER_VERSION` (when observing).
   - When `resolveJest()` fails (missing or unsupported Jest `< 29` or `>= 31`), return an honest unavailable environment (`runnerVersion: "unavailable"`, `state: "unavailable"`, actionable note) so files stay `unknown` and nothing is keyed or inherited.
3. **Static test enumeration & traits (`src/runners/jest/enumerate.ts`, `src/runners/jest/traits.ts`):**
   - `enumerate(filePath, testFile)` parses static `test(...)` / `it(...)` / `describe(...)` blocks (matching `node-test`'s static enumerator pattern so `enumerate` returns known checks cleanly without executing code).
   - `jestTraits(...)` matches `nodeTestTraits` / `pytestTraits` cleanly.
4. **Jest `RunnerAdapter` (`src/runners/jest/adapter.ts`, `src/runners/jest/index.ts`):**
   - Implements `RunnerAdapter` (`src/core/types/runner.ts`) cleanly:
     - `testFiles()`: lists project test files matching `project.include` / `project.exclude` inside `cwd` (or from resolved Jest config `testMatch` / `testRegex` when `include` is default).
     - `affected(changed)` & `closure(testFile)`: backed by `createJestGraph` (`src/runners/jest/graph/index.ts`), passing resolved `moduleNameMapper`, `moduleFileExtensions`, `setupFiles`, `setupFilesAfterEnv`, `snapshotResolver`, and `tsconfigPath`!
     - `invalidate(paths)`: updates graph and file list; recreates project (`recreatedProjects: [project.name]`) when Jest config, preset, babel config, tsconfig, or setup file list changes.
     - `environment()`: returns `[RunnerEnvironment]` with `observedLoads: true` (so `RunReport.loaded` + `recorder.cjs` observed inputs refine closures through Squeal's existing core path!).
     - `run(testFiles, runOptions)`: calls `runJest` (`src/runners/jest/run/run.ts`), wires `observe` (`recorder.cjs`) when `options.observe()` is true, reads `recorder.cjs` output into `RunReport.observed` (including `direct` for spawned child processes — Kit K10! — and `written` for directory creates/removes, reusing `src/runners/observe/read.ts` & `inputs.ts` cleanly!), and returns `RunReport` with `loaded` + `observed`.
     - If `resolveJest()` failed, `run()` returns an unavailable `RunReport` (`end: "crashed"`, `completedFiles: []`, `failure: note`) and never throws.
5. **Policy, host protocol, runner factory, and plugin build wiring:**
   - `src/core/types/policy.ts`: add `readonly jest: readonly JestProject[]` to `Policy` and `jest: []` to `DEFAULT_POLICY` (update `test/types.test.ts` and `test/daemon/policy.test.ts` snapshots cleanly).
   - `src/core/daemon/policy.ts`: wire `jest: (v) => jestProjects(v, "jest")` into `SHAPE`, and ensure repository-wide project-name uniqueness checks across `nodeTest`, `pytest`, and `jest` (check if uniqueness is checked in `policy.ts` or `policy-shared`!).
   - `src/core/daemon/policy-containers.ts`: add `"jest"` to `RUNNER_LISTS` so container target validation covers Jest projects too.
   - `src/core/daemon/jest-runners.ts`: `createJestRunners` and `createJestRunnerSet` matching `node-test-runners.ts` / `pytest-runners.ts` (including guarding `project.container` via `containerGuard` if `project.container !== undefined` so container-configured Jest projects never run on host/remote either!).
   - `src/core/runner-host/protocol.ts`, `runners.ts`, `proxy.ts`, `process-host.ts`: add `"jest"` to `HOST_RUNNERS`, `JestProject` to `ProcessHostOptions.project`, `case "jest"` in `buildAdapter`, `jestTraits` in `hostTraits`, and `createHostedJest` in `process-host.ts`.
   - `src/harness/build.ts`: copy `src/runners/jest/runtime/squeal-reporter.cjs` and `src/runners/jest/runtime/observe-runtime.cjs` into `<pluginDist>/jest/` alongside `dist/pytest/` and `dist/observe/` so bundled CLIs locate them via `jestRuntimeDir()`.
6. **Spec 016 correctness kit pack (`test/kit/packs/jest.ts`, `test/kit/jest.test.ts`):**
   - Implement `test/kit/packs/jest.ts` (so `test/runners/boundaries.test.ts` sees `src/runners/jest/adapter.ts` matched 1-to-1 with `test/kit/packs/jest.ts`!).
   - Run all kit scenarios (K1–K10) on BOTH **Jest 29.7.0** and **Jest 30.5.2** fixtures (using `test/helpers/jest-env.ts`).
   - Record any documented gap explicitly as `KNOWN` only if genuinely unfixable and citing Spec 028; aim for 100% green across K1–K10 on both majors!
7. **Tests & key validity:**
   - `test/runners/jest/environment.test.ts`: worktree-independent key equality across two worktree paths, config/env/package change re-keying, volatile field stripping, missing/unsupported Jest honest unavailable note.
   - `test/runners/jest/adapter.test.ts`: full adapter lifecycle (testFiles, affected, closure, invalidate, environment, run with `loaded` + `observed`, missing Jest refusal, `createHostedJest` round-trip).
   - `test/kit/jest.test.ts`: full Spec 016 kit K1–K10 on Jest 29 & 30.
   - Add `test/keys/validity/cases/policy-jest.ts` (registered in `test/keys/validity/cases/index.ts`) if needed so every changed line in `policy.ts` / `policy-containers.ts` runs in `test/keys/key-format.test.ts` with 12/12 passing!
   - Verify: `pnpm exec vitest run test/kit/jest.test.ts test/runners/jest/environment.test.ts test/runners/jest/adapter.test.ts test/daemon/policy.test.ts test/daemon/policy-jest.test.ts test/daemon/policy-containers.test.ts test/types.test.ts test/runners/boundaries.test.ts test/harness/shared/names-no-runner.test.ts test/keys/key-format.test.ts` and `pnpm run lint && pnpm run typecheck`.
