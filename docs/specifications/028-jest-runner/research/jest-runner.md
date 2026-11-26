# Research: jest-runner (spec 028)

Researcher: claude opus 5.5, 2026-11-26. Probes: `probes/jest-runner/` (throwaway, see its README).

Versions examined: Jest 29.7.0 (`@jest/core`, `jest-runtime`, `jest-config`, `jest-resolve`, `babel-jest` 29.7.0), Jest 30.5.2 (npm, 2026-11-26), `ts-jest` 29.1.3, `@nx/jest` and `@nx/react` 19.6.0, TypeScript 5.9.3 (the lockfile's resolution, not 5.5.4), Node 26.13.0. `apptension/saas-boilerplate` at `caa46d2`, read on a scratch clone in `$TMPDIR` with its lockfile installed there. `~/projects/saas-boilerplate` was never written: `git status --short` before and after is the same two pre-existing lines, and it has no `node_modules`. Official docs fetched 2026-11-26: `jestjs.io/docs/29.7/configuration`, `/docs/29.7/cli`, `/docs/configuration`, `/docs/upgrading-to-jest30`, `/docs/code-transformation`.

Host for every timing: 16 vCPUs, one-minute load 1.4 to 5.4 (stated per run in the probe output; never above 24). All timings are single local runs, not a benchmark. Warm means Jest's transform cache is already filled.

Disclosure: one probe call passed a test path after `--coverageReporters=json`, which took the path as a reporter name. Jest then ran the whole `webapp` project (38 files, 163 tests) twice under coverage before I stopped it. It was one project, on the scratch clone, not the repository's suite.

## Questions answered

| # | Question | Answer |
| --- | --- | --- |
| 1 | Anatomy of the 17 projects; direct runs; Jest 30 changes | 17 project configs, all on one preset; 202 test files by `--listTests`. Direct `jest --config <pkg>/jest.config.ts <file>` works without Nx. The root `jest.config.ts` is `export default {}`, not a projects list, and running it is wrong. Jest 30 breaks deep imports, `--testPathPattern`, old snapshot headers and `Runtime` internals. |
| 2 | Execution model | Subprocess per batch: about 2.0 s per batch on saas-boilerplate (warm). Warm host over the public `createTestScheduler`: about 0.2 s per file after a 1.3 s first file, but RSS grows about 18 MB per file, so it must recycle. `--watch` is not fit. |
| 3 | Closure observation inside the VM sandbox | Node module hooks see none of a test's imports. Wrapping the per-test-file `ScriptTransformer` from a `runtime` subclass gives the exact module list per test file on Jest 29 and 30. fs and spawn still need `recorder.cjs`. `--findRelatedTests` misses setup files, computed requires and every cross-project import. |
| 4 | Reporting, identity, failures, coverage | A reporter's synchronous append per `onTestFileResult` streams per file and survives a group kill (K8 holds on 29 and 30). Identity is `ancestorTitles + title`; duplicates occur. Raw V8 coverage arrives per file in `onTestFileResult`. |
| 5 | Environment identity, monorepos, seams | One process can hold all 17 projects for 0.2 s and 16 MB more than one. `squeal.config.json` should list Jest projects by config path. `RunnerAdapter` fits; the host registry, command descriptions, policy schema, a boundary regex and the recorder's file attribution need changes. |
| 6 | Recommendation | See "Recommendation for Squeal". |

## Findings

### Q1. Anatomy of saas-boilerplate's Jest projects

- **F1.1** Every project config sets `preset: '<relative>/jest.preset.js'`. The preset spreads `@nx/jest/preset`: `testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)']`, `resolver: '@nx/jest/plugins/resolver'`, `testEnvironment: 'jsdom'`, a catch-all `ts-jest` transform, and `testEnvironmentOptions.customExportConditions: ['node','require','default']`. It adds `moduleNameMapper` for `apollo-upload-client`, `uuid` (a hard-coded `.pnpm/uuid@9.0.1` path) and `env.vite`. Read in source (`jest.preset.js`, `@nx/jest/preset/jest-preset.js` 19.6.0).
- **F1.2** Resolved configs, from `--showConfig`, verified by experiment:
  - 14 web packages: `@nx/react/plugins/jest` for non-code files, then `babel-jest` with `presets: ['@nx/react/babel']`, then the preset's `ts-jest`. They have one `setupFilesAfterEnv` and their own `moduleNameMapper` entries before the preset's. They all run under `jsdom`.
  - `tools`, `infra-core`, `infra-shared`: `ts-jest` with `tsconfig.spec.json`, also `jsdom` (from the preset).
  - No project uses `setupFiles`, `@swc/jest`, `__mocks__` directories, `@jest-environment` docblocks or `.snap` files. 59 files call `jest.mock`.
  - Tests resolve `@sb/*` through pnpm workspace links that Jest realpaths into `packages/` (F3.5). The Nx resolver's TypeScript `paths` fallback runs only after the default resolver fails.
- **F1.3** `--listTests` per project finds 202 test files (webapp-core 59, webapp-tenants 40, webapp 38, 12 projects with 1 to 11, `infra-core` and `infra-shared` none). Verified by experiment. The brief's "243 of 311" is not reproduced at `caa46d2`: a name count finds 216 `*.test.*`/`*.spec.*` files.
- **F1.4** Direct runs without Nx work: `jest --config packages/<p>/jest.config.ts --cacheDirectory=$TMPDIR/... <file>` passes. Verified by experiment. One trap: Jest 29 loads `jest.config.ts` only through ts-node, and ts-node searches upward from the cwd for a `tsconfig.json`. The repository has only `tsconfig.base.json`, so a checkout nested under another TypeScript project picks up that project's compiler. Our scratch clone under this repository loaded TypeScript 7 and crashed with `Cannot read properties of undefined (reading 'ES2018')`. `TS_NODE_PROJECT` fixed it. Verified by experiment; read in source (`jest-config` 29.7.0 `readConfigFileAndSetRootDir.js`, ts-node 10.9.2). Jest 30 tries Node's native type stripping first (`process.features.typescript`), then ts-node or `esbuild-register` (read in source, `jest-config` 30.5.2).
- **F1.5** The root `jest.config.ts` is `export default {}`. It is not `getJestProjectsAsync()`. Running it lists 210 files. Among them are 8 non-tests, such as `packages/internal/cli/src/commands/test.ts` and two `__tests__/*.graphql.ts` helpers. It applies none of the project transforms or mappers. `nx.json` has no plugins and `useInferencePlugins: false`. The 14 web packages run tests through `package.json` `"test": "jest"`; the other 3 have no test target. Verified by experiment and read in source.
- **F1.7** Jest 30 changes that touch an adapter (read in official docs, `upgrading-to-jest30`, version 30.5):
  - Packages are bundled, so "any unofficial deep imports into Jest's packages will likely break".
  - Constructing a `Runtime` "now requires a globalConfig parameter".
  - `--testPathPattern` became `--testPathPatterns`.
  - jsdom v26; Node 18 and TypeScript 5.4 minimums.
  - Snapshots drop the `goo.gl` link. A `.snap` with the old header fails the whole file in 30.5.2 ("Outdated guide link"). Verified by experiment.
  - Verified by experiment: `jest-runtime` 30 moved module loading into internal classes, so `_loadModule` and `readFile` overrides no longer run. `requireModule`, `requireModuleOrMock` and the transformer methods remain.

### Q2. Execution model

| Run (saas-boilerplate, `--runInBand`) | Cold | Warm |
| --- | --- | --- |
| Config and haste map only (`--listTests`), any project | 0.80 to 0.87 s, 225 MB | same |
| webapp-core, 1 file (babel-jest, jsdom) | 3.11 s, 408 MB | 1.97 s, 341 MB |
| webapp-core, 5 files | 3.63 s, 479 MB | 2.78 s, 411 MB |
| tools, 1 file (ts-jest, jsdom) | 1.53 to 1.81 s, 360 to 390 MB | 1.39 to 1.55 s, 325 to 348 MB |
| webapp `app.component.spec.tsx` (724 project modules) | 5.95 s, 653 MB | 2.70 s, 386 MB |
| Synthetic fixture, node env / jsdom env | 0.47 s / 0.69 s | 0.38 s / 0.60 s |

- **F2.1 (a) Subprocess per batch.** The fixed cost is about 1.8 s per process on saas-boilerplate and about 0.2 s per extra file. Verified by experiment. The extra cost over the synthetic fixture comes from ts-node config loading, the Nx resolver, babel, React and `setupTests`. Revision freshness is trivial: each process reads the files as they are. Jest's transform cache is content-keyed (`babel-jest` hashes source text, options, `configString`, `NODE_ENV`, `BABEL_ENV` and the Node version). It is written with `write-file-atomic`. A torn haste-map file fails `deserialize` and is rebuilt. Read in source (`@jest/transform` and `jest-haste-map` 29.7.0).
- **F2.2 (b) Warm host.** `@jest/core` exports `runCLI`, `createTestScheduler` and `SearchSource`. Read in source. The probe ran six webapp-core runs in one process (load 3.2). Verified by experiment:
  - `runCLI` per call: 1.84 s first, then 0.30 to 0.49 s.
  - Config, haste map and context built once (0.55 s), then `createTestScheduler().scheduleTests()` per run: 1.29 s first file, then 0.14 to 0.22 s.
  - Over 30 runs RSS grew from 216 MB to 746 MB, about 18 MB per file, at a steady 0.19 to 0.22 s. Jest documents `workerIdleMemoryLimit` as "primarily a work-around" for this leak in its own workers (read in official docs, 29.7). So a warm host must recycle above a memory limit.
  - Freshness, verified on Jest 29 and 30 (`warm-fresh.cjs`): a source edit and a manual-mock edit are seen on the next run. A `jest.config.js` edit is not, because Node's `require` cache keeps the old config; it is seen once that cache entry is deleted. The scheduler form also keeps its haste map, so added files and new `__mocks__` need a rebuild. A config change, or an add or delete, must recreate the project context. `InvalidateResult.recreatedProjects` already models this.
  - The host must set `NODE_ENV=test` when unset, as `jest-cli/bin/jest.js` does, and pass absolute project paths to `readConfigs`: a relative `.` became a second, default project without the babel preset. Verified by experiment.
- **F2.3 (c) `--watch`.** Runs start from the haste map's own `change` events. Control is keypresses on a raw-mode stdin (`@jest/core` 29.7.0 `watch.js`, `hasteMapInstance.on('change', ...)` then `startRun`). Read in source. A run cannot be tied to a Squeal revision, and filtering means driving the interactive UI. Inferred: not fit.
- **F2.4 Deadline kill.** Jest in its own process group (`setsid`) with `--runInBand` and with `--maxWorkers=2` (3 processes) was killed during a hanging test. On SIGTERM the whole group was gone within 2 s. The two completed files' results were on disk; the cut file had only `fileStart` and one `case` line. A rerun on the same cache passed. Verified by experiment, Jest 29 and 30. With workers, `onTestFileStart` fires at dispatch, so "started" does not mean "running".

### Q3. Closure and module observation inside Jest's VM sandbox

Fixture: `test/one.test.js` (node env) loads `a → b → c` (a re-export), `@lib/util` (mapped), a manually mocked module, a computed `require`, JSON, CSS (mapped), and reads a file. It starts a child that reads a file and takes a snapshot. `test/two.test.js` (jsdom) loads `a` only. Both share `setupFiles` and `setupFilesAfterEnv` with one import each. Both run in one `--runInBand` process. Verified by experiment on Jest 29.7.0 and 30.5.2 unless stated.

| Mechanism | Per test file | Mapped, re-export, JSON | Manual mock | Setup files and their imports | Computed `require` | fs read, child read, `.snap` |
| --- | --- | --- | --- | --- | --- | --- |
| `recorder.cjs` `d`/`m` (Node `registerHooks`) | no | none: only `jest.config.js` and the child entry | no | no | no | (n/a) |
| `recorder.cjs` `f` (fs hooks) | only with one test file per process (`settings.file`) | yes, as reads | yes | yes | yes | yes, plus `.babelrc*` probes in every directory and haste-crawl stats |
| Wrapping `resolver` | no: per worker, cached per `(dirname, request)` | yes | no: sees `src/mocked.js`, not the mock | yes | yes | no |
| `runtime` subclass wrapping the `ScriptTransformer` | yes | yes | yes | yes | yes | no |
| `--findRelatedTests` (per project) | n/a | yes | yes, both real and mock | no | no | no |

- **F3.1** Jest loads project modules through `jest-runtime`, never Node's loader. `recorder.cjs`'s module hooks see nothing of the test's imports. Its fs wrapper does see every module source, because `jest-runtime` reads through `graceful-fs`, which copies the already-patched `fs`. Attribution is the gap: `current()` knows only `__vitest_worker__.filepath` or the process's `settings.file` (`src/runners/observe/recorder.cjs:134`), and a Jest process runs many files. Verified by experiment.
- **F3.2** The `runtime` option is documented in 29.7 and current docs: "The runtime module must export a class that extends Jest's default Runtime class" (read in official docs). Its constructor receives the per-test-file `ScriptTransformer` and the test path (`jest-runner` 29.7.0 `runTest.js:201-276`). Every CJS, ESM and JSON module passes through `transform`, `transformAsync` or `transformJson` (read in source, `jest-runtime` 29.7.0 and 30.5.2). Wrapping those methods gave the exact per-file lists above on both versions. Jest's resolver cache did not hide `a`, `b`, `c` from `two.test.js`. On saas-boilerplate it attributed 724 project modules across 11 packages and 2,435 `node_modules` modules to `app.component.spec.tsx`. Overhead was within noise: 2.60 to 2.96 s observed against 2.73 to 3.00 s plain. Verified by experiment.
- **F3.3** ts-jest type-checks. `tools/.../setup/executor.spec.ts` fails with TS2741 because of `schema.d.ts`, which no runtime hook sees. The transform list held only the test file. `recorder.cjs` `f` saw `schema.d.ts` among 311 project paths. Verified by experiment. So ts-jest projects need fs observation or a static type-import graph. Runtime observation alone would miss type-only inputs.
- **F3.4** `--findRelatedTests` costs 0.97 to 1.12 s per project query. A change to `webapp-core`'s `button.component.tsx` finds 10 tests from the webapp-core config, but 0 from `webapp` and `webapp-tenants`. Each project's haste map indexes only its own `rootDir`, yet `webapp` source imports those buttons. Verified by experiment. It also misses setup-file imports, so an edit to `setupTests.ts` would select nothing.
- **F3.5** Cross-package modules appear at their `packages/...` real paths, so `recorder.cjs`'s `node_modules` filter keeps them. Verified by experiment. Snapshot paths are deterministic (`__snapshots__/<file>.snap` unless `snapshotResolver`); inferred: the adapter supplies them as `RunnerClosure.snapshot`.

### Q4. Reporting, identity, failures, coverage

- **F4.1** A reporter that `appendFileSync`s one JSON line per `onTestFileStart`, `onTestCaseResult`, `onTestFileResult` and `onRunComplete` streamed file by file under `--runInBand` and `--maxWorkers=2`. Verified by experiment, 29 and 30. `--reporters=<path>` is a CLI flag; `runtime` is not, so it needs a wrapper config or a programmatic config (`wrap-config.cjs` loads the project's TS config and adds it).
- **F4.2** Identity: each case carries `ancestorTitles` and `title`. Jest's `fullName` joins them with spaces. Verified by experiment:
  - Two `test('dup')` in one block give equal names. `--testLocationInResults` adds `{line, column}` on 29 and 30, so Squeal's existing rule applies: a duplicate gets a `(line N)` suffix (`src/runners/vitest/results.ts:136-150`).
  - `test.each` expands into formatted titles that share one line, so the `(line N, 2)` ordinal applies.
  - Statuses are `passed`, `failed`, `pending` (`test.skip` and `describe.skip`) and `todo`.
  - A failing `test.failing` reports `passed`.
  - `onTestCaseResult` is not emitted for skipped cases. They appear only in `onTestFileResult`.
- **F4.3** Errors, verified by experiment:
  - A syntax error, a throw at load, a missing `@jest-environment` and a ts-jest type error each give `testExecError` with empty `testResults`. Syntax errors carry `code: 'BABEL_PARSE_ERROR'`.
  - An unhandled rejection fails the running test.
  - `console.error` is in `result.console`.
  - With `--ci`, a missing snapshot fails and is not written. A mismatch counts in `snapshot.unmatched`. An obsolete entry appears in `snapshot.uncheckedKeys`.
  - A test that leaves an interval keeps Jest alive after `onRunComplete`. The first report probe hung until killed. `--forceExit` ends it. `openHandles` stays 0 unless `--detectOpenHandles`.
- **F4.4** K8 holds as F2.4 shows. Completed files are on disk before the next file starts. A cut file has `fileStart` and maybe some `case` lines but no `fileResult`, so the adapter must drop case lines without a `fileResult` and report that file `unknown`.
- **F4.5** With `--coverage --coverageProvider=v8`, each `onTestFileResult` carries `v8Coverage`: `[{codeTransformResult, result}]`, where `result` is a raw V8 `ScriptCoverage` over the transformed code and `codeTransformResult` holds the code and source map. Verified by experiment, 29 and 30. It is not a loaded-module list: it excludes the test file, mocks, JSON and `setupFiles` (7 entries against 13 modules). Our reporter's `onRunComplete` saw no `coverageMap`. Cost on `app.component.spec.tsx`, warm: 2.90 to 3.13 s plain, 3.23 to 3.44 s with V8 (+75 MB), 3.13 to 3.16 s with babel instrumentation. Mapping raw V8 to `CoverageRecord` (spec 015) is inferred to work like the Vitest host's raw payloads (spec 026 line 272). It is not tested here.

### Q5. Environment identity, monorepos, seams

- **F5.1** One process loading all 17 project configs and building their haste maps: 0.76 s, 230 to 242 MB, 1,320 files indexed. One project: 0.54 to 0.57 s, 205 to 228 MB. Verified by experiment.
- **F5.2** Inputs `environment()` must hash per project. Inferred from F1, F2.1 and `babel-jest` `getCacheKeyFromConfig` (read in source):
  - Resolved config from `readConfigs`, as `--showConfig` prints it, with absolute paths made worktree-relative. Drop `cacheDirectory`, `seed`, `maxWorkers`, reporters and Squeal's `runtime`.
  - Config files: the project's `jest.config.*`, the preset file and the `@nx/jest/preset` version, `babel.config.*` and every `.babelrc*` the probes read, `tsconfig.spec.json` and its `extends` chain (ts-jest and the Nx resolver fallback), and the `setupFiles` and `setupFilesAfterEnv` closures.
  - Installed versions of `jest`, `jest-environment-jsdom`, `babel-jest`, `ts-jest`, `@babel/core`, `typescript`, `@nx/jest` and `@nx/react`. The lockfile packages segment covers these.
  - The Node version, and `NODE_ENV` and `BABEL_ENV` (both in `babel-jest`'s cache key). `TZ`. `TS_NODE_*` on Jest 29 (F1.4).
- **F5.3** `RunnerAdapter` fits unchanged. Inferred from the seam reading of `src/core/types/runner.ts`:
  - `closure` gets runtime lists through `RunReport.loaded`. Jest always isolates module registries per file, which is spec 022's precondition.
  - `invalidate` returns recreated projects.
  - `signal` and `stop` cover both execution models.

  What changes, read in source:
  - The runner host's closed list: `HOST_RUNNERS` (`src/core/runner-host/protocol.ts:22`), its project union (`:127`), `buildAdapter` (`runners.ts`), `hostTraits` (`proxy.ts`).
  - `DESCRIPTIONS` and the runner unions in `src/runners/descriptions.ts`. Today no description recognizes `pnpm`, `yarn` or `nx` forms. Jest needs `jest`, `npx jest`, `pnpm jest` and `pnpm exec jest`. It also needs a package script that is exactly `jest`, run as `pnpm test` in a package or `pnpm --filter <p> test`, and `pnpm nx run <p>:test`.
  - The policy schema: a `jest` key beside `nodeTest` and `pytest` (`src/core/daemon/policy.ts:99-101`).
  - `test/harness/shared/names-no-runner.test.ts`: its name regex lacks `jest`.
  - `recorder.cjs` attribution: a runner-neutral current-file global set by the Jest `runtime` subclass. This is core-owned (011 C12). Without it, fs and spawn observation needs one test file per process.
  - Spec 026 remote execution needs the adapter to run inside the runner host. Both models do.

## Recommendation for Squeal

Build `src/runners/jest/` as a hosted adapter over the project's own Jest. Resolve Jest as jest → jest-cli → @jest/core, as `resolve-runtime.cjs` does; pnpm hoists none of these.

1. **Projects.** List them by config file in `squeal.config.json`, for example `"jest": {"projects": [{"name": "webapp", "config": "packages/webapp/jest.config.ts"}]}`. Include `cwd`, `env`, `include`, `exclude` and `slow` as for `nodeTest`. `squeal setup` finds `jest.config.{js,ts,mjs,cjs,json}` and `package.json` `jest` keys. When a root config has `projects`, including Nx's `getJestProjectsAsync()`, it expands them once with `readConfigs` and writes the list. It never treats saas-boilerplate's empty root config as a project (F1.5). One host per worktree holds all projects (F5.1).
2. **Execution, first wave.** Subprocess per batch per project:
   - `--runInBand` or a small `--maxWorkers`, `--ci`, `--forceExit`, `--testLocationInResults`, `--cacheDirectory` in Squeal's cache.
   - The streaming reporter, and a generated wrapper config that adds the observing `runtime`.
   - `NODE_ENV=test` when unset.
   - The process group rules node:test and pytest already use.

   This is correct at once and costs about 2 s per batch on saas-boilerplate.
3. **Execution, later wave.** A warm Jest child per project group over `createTestScheduler`, for about 0.2 s per file:
   - Recycle above an RSS limit derived from the machine, like Jest's `workerIdleMemoryLimit`.
   - Recreate on config or add/delete invalidation (F2.2).
   - Exit when idle.
4. **Closure.** Three parts:
   - The `runtime` subclass wrapping the `ScriptTransformer` gives per-file module lists on 29 and 30. It feeds `loaded` and closure keys.
   - `recorder.cjs` gives fs, spawn and ts-jest type inputs, once attribution is runner-neutral.
   - For `affected` before a file has run, extend the node-test static graph with `moduleNameMapper` and tsconfig `paths`. Add setup files to every test's closure.

   Do not use `--findRelatedTests` (F3.4).
5. **Kit pack** `test/kit/packs/jest.ts` on 29.7 and 30.x. Likely KNOWN gaps:
   - K4 for reads that happen outside a test file's run.
   - K5 when a computed path is loaded by a transformer outside `jest-runtime`.

   Inferred; to be confirmed by the pack.

Rough waves: (1) config, discovery, subprocess runs, reporter, identity, K1 to K3, K8, K9. (2) runtime observer, recorder attribution, static graph, `environment()`, K4 to K7, K10. (3) command recognition, `squeal setup` for Jest and Nx, V8 coverage. (4) warm host with recycling, then the remote lane.

## Open questions for the human

1. Support Jest 29 only first, or 29 and 30 together in the kit? saas-boilerplate pins `^29.7.0`.
2. Ship subprocess-per-batch first (about 2 s per batch, no idle memory), or go straight to a warm host (about 0.2 s per file, 300 to 750 MB per worktree until recycled or idle)?
3. Should Squeal take over `pnpm nx run <p>:test` and `nx affected -t test`, or only plain `jest` forms? Nx has its own cache.
4. For ts-jest projects, accept fs observation's wide input set (311 paths for one tools file), or ask projects to set `isolatedModules`?
5. Not determined, because I could not reproduce the brief's numbers: where do "243 of 311 test files" come from? At `caa46d2` Jest lists 202.

## Sources

- Jest docs, fetched 2026-11-26: https://jestjs.io/docs/29.7/configuration (`runtime`, `resolver`, `workerIdleMemoryLimit`, `testLocationInResults`), https://jestjs.io/docs/29.7/cli, https://jestjs.io/docs/configuration, https://jestjs.io/docs/upgrading-to-jest30, https://jestjs.io/docs/code-transformation.
- Jest source in `node_modules`:
  - 29.7.0: `jest-runner/build/runTest.js`, `jest-runtime/build/index.js`, `jest-resolve/build/resolver.js`, `jest-config/build/readConfigFileAndSetRootDir.js`, `jest-config/build/index.js` (`readConfigs`), `@jest/core/build/{index,watch,cli/index}.js`, `@jest/transform/build/ScriptTransformer.js`, `jest-haste-map/build/index.js`, `babel-jest/build/index.js`, `jest-cli/bin/jest.js`.
  - 30.5.2: `jest-runtime/build/index.js`, `jest-runner/build/index.js`, `jest-config/build/index.js`.
- `@nx/jest` 19.6.0 `preset/jest-preset.js`, `plugins/resolver.js`; `@nx/js` 19.6.0 `babel.js`.
- https://github.com/apptension/saas-boilerplate at `caa46d26e01f9cd2c29f0e67bb72ff073c755053` (read-only scratch clone): `jest.config.ts`, `jest.preset.js`, `nx.json`, `babel.config.json`, `tsconfig.base.json`, 17 `packages/**/jest.config.ts`, package `project.json` and `package.json` files.
- This repository: `src/core/types/runner.ts`, `src/core/runner-host/`, `src/runners/observe/recorder.cjs`, `src/runners/descriptions.ts`, `src/runners/vitest/results.ts`, `src/core/daemon/policy.ts`, `test/kit/`, `test/runners/boundaries.test.ts`, `test/harness/shared/names-no-runner.test.ts`, specs 011, 013, 016, 022, 026.
- Probes: `probes/jest-runner/` (its README lists each script).
