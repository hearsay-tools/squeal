# Spec 028 Wave 3: `squeal setup` Jest discovery, opt-in `describe.ts`, and V8 coverage (Row `028-06`)

Spec: `docs/specifications/028-jest-runner/spec.md` (D1.2, D5.3, D6.3).
Prerequisites landed on `main`: `028-02` (`0.1.642`), `028-03`, `028-04` (`0.1.643`), `028-05` (`0.1.644`).

Row `028-06` is split into two strictly disjoint workers running in parallel. Do **not** run `pnpm run build` in worker worktrees (the coordinator wires `daemon.ts`'s `coverage` pass into `createJestRunnerSet` and rebuilds all five plugin bundles at integration). Do **not** run a full local test suite or set timers waiting on Squeal background backlogs. Use `TMPDIR=/tmp` for Jest tests so `test/helpers/jest-env.ts` reuses `/tmp/squeal-jest-29-2754338cf9ef` and `/tmp/squeal-jest-30-b9e0c22dec2f` without reinstalling; never mutate those cached fixtures.

---

## Worker A (Row `028-06a`): `squeal setup` Jest discovery + opt-in `src/runners/jest/describe.ts`

### Ownership
- `src/cli/jest-seed.ts` (new)
- `src/cli/setup/jest.ts` (new)
- `src/cli/setup/plan.ts`
- `src/cli/setup/runners.ts`
- `src/cli/setup/format.ts`
- `src/cli/setup/apply.ts`
- `src/runners/jest/describe.ts` (new)
- `src/runners/descriptions.ts`
- `test/harness/shared/names-no-runner.test.ts`
- `test/cli/setup/jest.test.ts` (new)
- `test/runners/jest/describe.test.ts` (new)

### Requirements

1. **`squeal setup` Jest & multi-project/Nx discovery (D1.2):**
   - Implement `src/cli/jest-seed.ts` (mirroring `src/cli/pytest-seed.ts` cleanly):
     - Scans tracked files for `jest.config.{js,ts,mjs,cjs,json}` and `package.json` files holding a top-level `"jest"` key (skipping `node_modules`, `.git`, `fixtures`, `__fixtures__`).
     - Resolves candidates using Jest's own `readConfigs` (from `src/runners/jest/resolve.ts`, running in a short-lived child process when Jest is installed, with a safe static fallback noting when Jest is not installed yet):
       - **Root `projects` expansion:** When a root config defines a non-empty `projects` array (including `@nx/jest`'s `getJestProjectsAsync()`), expand it into explicit `JestProject` entries (`name` from `displayName` or relative package folder name, `config` repo-relative, `cwd` when different from `dirname(config)`) and do **not** register the root wrapper as a project.
       - **Empty / catch-all root config skip:** When a root config has no `projects` AND sits above nested `jest.config.*` files (or matches zero unique test files, as in `saas-boilerplate`'s `export default {}`), skip the root config with a clear note rather than registering an unconfigured catch-all.
       - Ensure generated project names are deterministic, unique across discovered projects, and valid under `Policy.jest`.
   - Implement `src/cli/setup/jest.ts` (mirroring `src/cli/setup/pytest.ts`):
     - `jestRunners(facts, policy, raw)` returns configured `policy.jest` entries (`source: "config"`) or seeded entries (`source: "seed"`) when `jest` is not declared in `squeal.config.json`.
     - `writeJestSeed(root, plan)` writes seeded `jest` projects into `squeal.config.json` when setup applies choices and `jest` is not yet declared.
   - Wire into `src/cli/setup/plan.ts`, `src/cli/setup/runners.ts`, `src/cli/setup/format.ts`, and `src/cli/setup/apply.ts` (additive optional `Runners.jest` field on `SetupPlan`, keeping `SETUP_PLAN_SCHEMA_VERSION = 1` backwards-compatible and existing setup tests green).

2. **Opt-in plain-Jest command description (`src/runners/jest/describe.ts`, D6.3):**
   - Implement `JEST` (`satisfies RunnerDescription`) in `src/runners/jest/describe.ts`, matching `src/runners/pytest/describe.ts` and `src/runners/node-test/describe.ts`:
     - Active only via Squeal's existing `testCommand.denyWhenCurrent` gate (default `false`); never rewrites commands; shell metacharacters (`| tail`, `| head`, `&&`, redirects, globs, leading `VAR=val`) fall through via `shellWords()`.
     - Recognizes **only** plain direct Jest invocations from a configured Jest project's `cwd` (when exactly one configured Jest project runs from that `cwd`, and `project.env` is empty so the command cannot omit env):
       - `jest`, `npx jest`, `pnpm exec jest`, `./node_modules/.bin/jest`
       - bare `npm test` / `pnpm test` **only** when that directory's `package.json` `"test"` script is bare `jest` (plus optional safe output flags) with no `pretest` or `posttest` scripts.
     - Recognizes only safe output flags (`--verbose`, `--silent`, `--no-color`, `--colors`, `--ci`, `--runInBand`) and explicit listed test files.
     - Falls through (`null`) on `-t`, `--testNamePattern`, `-u`, `--updateSnapshot`, `--watch`, `--watchAll`, `--config` / `-c`, directories, unlisted files, or any unknown flag.
     - **Never** recognizes Nx commands (`nx ...`, `pnpm nx run ...`, `npx nx ...`).
     - `files(command, listing)` resolves only when every named path matches a listed test file of that project (never bare `jest` with no paths or a directory).
   - Wire `JEST` into `src/runners/descriptions.ts` (`DESCRIPTIONS`, `RunnerCoverage`, `CommandContext`, `TestCommand`, `UNCONFIGURED`, `runnerCoverage`, `commandContext`).
   - Update `test/harness/shared/names-no-runner.test.ts`: add `jest` to the forbidden `RUNNER` regex and `"jest"` to the runner list so `src/harness/shared/` stays strictly runner-agnostic (Spec 016 D5).

3. **Tests:**
   - `test/cli/setup/jest.test.ts`: single-project discovery, multi-project root `projects` expansion (Jest 29 & 30), skipping empty root `export default {}` above nested `jest.config.*` (exact `saas-boilerplate` shape), `package.json` `"jest"` key, `writeJestSeed`, and preserving already-declared `jest` config.
   - `test/runners/jest/describe.test.ts`: plain Jest invocations (`jest`, `npx jest`, `pnpm exec jest`, bare `npm test`/`pnpm test`), safe flags, refusal/fallthrough on `-t`, `-u`, `--watch`, `| tail`, `&&`, `VAR=1 jest`, directories, unlisted files, `pretest`/`posttest`, `project.env` non-empty, and **Nx commands** (`pnpm nx run webapp:test`, `nx affected -t test`, `npx nx test`).
   - Verify `test/harness/shared/names-no-runner.test.ts`, `test/runners/boundaries.test.ts`, and existing `test/cli/setup/` tests pass!

---

## Worker B (Row `028-06b`): Jest V8 coverage (`CoverageRecord`, Spec 015) + `ts-jest` `.d.ts` attribution regression

### Ownership
- `src/runners/jest/coverage.ts` (new)
- `src/runners/jest/runtime/squeal-reporter.cjs`
- `src/runners/jest/run/run.ts`
- `src/runners/jest/run/events.ts`
- `src/runners/jest/adapter.ts`
- `src/runners/jest/environment.ts`
- `src/core/daemon/jest-runners.ts`
- `src/core/runner-host/process-host.ts`
- `src/core/runner-host/runners.ts`
- `test/runners/jest/coverage.test.ts` (new)
- `test/runners/jest/ts-jest-dts.test.ts` (new)

### Requirements

1. **Per-file V8 coverage in Jest runs (Spec 028 D5.3, Spec 015):**
   - Study `src/runners/node-test/coverage.ts`, `src/core/code/coverage/types.ts`, and `src/core/code/coverage/mapper.ts` to match Squeal's exact `RunnerCoverageOptions` contract!
   - Keying (`src/runners/jest/environment.ts` + `src/runners/jest/coverage.ts`):
     - When `coverage.enabled()` is `false` or absent, runs take **no** coverage and the Jest environment key stays identical (zero drift when coverage is off!).
     - When `coverage.enabled()` is `true`, record the coverage marker in `jestEnvironment` config (matching `node-test`'s `ProjectCoverage` pattern: `invalidate()` recreates the project when `coverage.enabled()` toggles!).
     - Honor Spec 015 D8 Fidelity: if a test file's closure imports `node:inspector` / `inspector`, skip coverage for that file (or project if setup files import it) and note once.
   - Collection (`src/runners/jest/run/run.ts`, `src/runners/jest/runtime/squeal-reporter.cjs`):
     - When a batch runs with coverage enabled, pass `--coverage --coverageProvider=v8 --coverageReporters=` (empty reporter list so Jest writes zero disk coverage reports!) and set `SQUEAL_JEST_COVERAGE_DIR=<logDir>/cov` (or per-batch folder).
     - In `squeal-reporter.cjs` `onTestFileResult(test, result)`:
       - When `SQUEAL_JEST_COVERAGE_DIR` is set and `Array.isArray(result.v8Coverage)` with entries:
         - Write one V8 payload file per completed test file into `SQUEAL_JEST_COVERAGE_DIR` containing `{ result: [...] }` (the raw V8 `ScriptCoverage` objects from `result.v8Coverage.map(e => e.result)`).
         - Check how `sources` (`Map<string, ExecutedSource>`) works in `src/core/code/coverage/types.ts` and `src/runners/vitest/coverage.ts`: when Jest transforms TypeScript/JSX via `babel-jest` or `ts-jest`, `entry.codeTransformResult` carries `{ code, originalCode, sourceMapPath }` so populate `sources` from `codeTransformResult` to map V8 line/function offsets accurately back to original TypeScript/JS lines!
         - Emit the written coverage file metadata in the `fileResult` JSONL event (`coverageFile` + `transformSources`), only for completed files (so killed/incomplete files never emit partial coverage).
   - Wire `coverage?: RunnerCoverageOptions` through:
     - `JestAdapterOptions` (`src/runners/jest/adapter.ts`)
     - `JestRunnersOptions` (`src/core/daemon/jest-runners.ts`)
     - `createHostedJest` (`src/core/runner-host/process-host.ts`)
     - `buildAdapter` `"jest"` case (`src/core/runner-host/runners.ts`)
     - (Note: coordinator will pass `coverage` into `createJestRunnerSet` in `src/core/daemon/daemon.ts` at integration to avoid touching `daemon.ts`.)

2. **`ts-jest` `.d.ts` attribution regression (Spec 028 Testing):**
   - Add `test/runners/jest/ts-jest-dts.test.ts`:
     - Verify on real Jest (using the cached fixture and a lightweight local Jest custom transformer in the test that reads a `.d.ts` file via `fs.readFileSync` during `process()`, or `ts-jest` if installed in the fixture) that `recorder.cjs` attributes the `.d.ts` read to the exact test file via `Symbol.for("squeal.currentTestFile")` inside a multi-file batch, and that editing the `.d.ts` file re-keys and re-runs ONLY the affected test file!

3. **Tests:**
   - `test/runners/jest/coverage.test.ts` on **both Jest 29.7.0 and Jest 30.5.2**:
     - Coverage off: zero coverage files written, environment key unchanged.
     - Coverage on: runs `--coverage --coverageProvider=v8 --coverageReporters=`, invokes `coverage.collected` with valid V8 payload & `sources`, maps through Squeal's real coverage mapper (`mapFile` / `createMapper`) to accurate covered line/function hits on a source module (including a transformed file with a source map!), leaves zero `coverage/` folder in the worktree, and toggling `coverage.enabled()` triggers `recreatedProjects` on `invalidate()`.
     - Mid-batch cancellation with coverage on preserves completed file coverage and discards incomplete file coverage.
   - Verify `pnpm run lint`, `pnpm run typecheck`, `test/runners/boundaries.test.ts`, `test/kit/jest.test.ts`, and local `test/keys/key-format.test.ts`!
