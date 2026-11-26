# Research brief for spec 028: Jest runner

Read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `docs/decisions/0002-content-keyed-shared-store.md`, and `../status.md` first.

Also read these existing runner specs and contracts to understand Squeal's exact boundaries:
- `../../011-core/spec.md` (C3 keys, C4 scheduling, C12 observed paths, C14 `RunnerAdapter`)
- `../../016-extensions/spec.md` (`test/kit/`, core-owned observed paths, `test/runners/boundaries.test.ts`, `test/harness/shared/names-no-runner.test.ts`)
- `../../003-node-test-runner/spec.md`, `../../007-pytest-runner/spec.md`, `../../013-vitest-runner/spec.md`, and `../../022-selection-strategy/spec.md`
- `src/core/types/runner.ts`, `src/runners/observe/recorder.cjs`, and `test/kit/packs/`

The human, 2026-11-26, wants Squeal to run the test suite of `~/projects/saas-boilerplate` (`https://github.com/apptension/saas-boilerplate`, public MIT repo), where 243 of 311 test files across 17 packages run on Jest 29 (`@nx/jest`).

Write your findings to `research/jest-runner.md` in this folder and commit them with any throwaway probes.

## Rules for findings documents

- Length: 2 to 4 pages. Structure: Questions answered (a table), Findings per question, Recommendation for Squeal, Open questions for the human, Sources.
- Mark every finding `verified by experiment`, `read in official docs`, `read in source code`, or `inferred`. Name commits read and tool versions with retrieval dates.
- Sources: official docs (Jest 29 / Jest 30 / `@nx/jest`), this repository, and `~/projects/saas-boilerplate` (read-only). Do not search the open web beyond named tools' official docs. Where a source does not answer a question, write "not determined, because".
- Private material rule (`docs/styleguide.md`): never commit absolute home paths (write `~`), recorded agent session logs or transcripts, or names of private client repositories. Run `pnpm run check:private` before committing.
- No em-dashes. Short sentences. Data over adjectives.
- Safety for probes on `~/projects/saas-boilerplate`:
  - **NEVER modify `~/projects/saas-boilerplate`**. Leave its git status and working tree completely clean (no new files, no modified files, no untracked caches). If running read-only Jest commands against it (when its `node_modules` is present), always pass `--cacheDirectory="$TMPDIR/..."` and `--no-coverage` (or direct any output to `$TMPDIR`) and verify `git -C ~/projects/saas-boilerplate status --short` is unchanged afterwards.
  - Build synthetic throwaway fixtures under `$TMPDIR` (and keep probe scripts under `research/probes/jest-runner/` with a `README.md` marking them throwaway; keep `node_modules` out of git).
  - Report one-minute host load beside every local timing measurement. Skip timing measurements if load exceeds 24.
  - Do not run a full test suite in Squeal or `saas-boilerplate`.
- Do not design the full feature or edit `docs/board.md`, `spec.md`, or product code. Touch nothing outside `docs/specifications/028-jest-runner/research/`.

---

## Topic: jest-runner

Context observed in `~/projects/saas-boilerplate`:
- Monorepo: Nx 19.6.0, pnpm 10.26.2, Jest `^29.7.0`, `@nx/jest` 19.6.0, `ts-jest` 29.1.3, `babel-jest` 29.7.0, `jest-environment-jsdom` 29.7.0, React 19, TypeScript 5.5.4.
- Root `jest.config.ts` and `jest.preset.js` (with `moduleNameMapper` mocking `apollo-upload-client`, `uuid`, `env.vite`), plus 17 project-level `jest.config.ts` files:
  - `packages/webapp` (54 test files)
  - 13 `packages/webapp-libs/*` packages (173 test files)
  - `packages/infra/infra-core`, `packages/infra/infra-shared` (2 test files)
  - `packages/internal/tools` (14 test files)
- `packages/webapp/project.json` has no explicit `test` target (inferred by `@nx/jest` plugin in `nx.json`).

Questions to answer:

1. **Anatomy of `saas-boilerplate`'s 17 Jest projects (and general Jest 29/30 projects):**
   - Inspect `jest.config.ts`, `jest.preset.js`, `nx.json`, `tsconfig.base.json`, and a sample of the 17 project `jest.config.ts` files (including `webapp`, `webapp-core`, `webapp-api-client`, `infra-core`, `internal/tools`).
   - Document: how each project configures transforms (`ts-jest`, `babel-jest`, `@swc/jest`), testEnvironment (`jsdom`, `node`), `setupFiles` / `setupFilesAfterEnv`, `moduleNameMapper`, `testMatch`, snapshots, and whether `pnpm exec jest --config <pkg>/jest.config.ts <file>` works directly without going through Nx (verify by experiment if `node_modules` is present, using `--cacheDirectory=$TMPDIR/...`; also check what happens when running root `jest.config.ts` with all 17 projects vs a single project config!).
   - Check Jest 29 vs Jest 30 breaking changes (official docs / changelog) that affect config loading, programmatic API, custom reporters, or resolvers.
2. **Execution model: subprocess per batch vs warm `@jest/core` host vs `--watch`:**
   - Compare:
     (a) **Subprocess per batch** (`jest --runInBand` or `--maxWorkers=...` with custom streaming reporter + persistent Jest transform cache).
     (b) **Warm runner host** (long-lived child process holding `@jest/core` / `jest-haste-map` / `TestScheduler` / resolved config, reusing Squeal's `src/core/runner-host/` pattern like Vitest).
     (c) **Jest `--watch` mode** driven over stdin/custom watch plugin.
   - Measure by experiment (cold cache vs warm cache, 1 test file vs 5 test files, `node` env vs `jsdom` + `ts-jest`/`babel-jest` on both a small synthetic fixture and 1 to 2 real files from `saas-boilerplate` if `node_modules` is installed): startup time, per-file run time, and RSS memory.
   - Check how each model handles: revision freshness (never running stale code), `jest.resetModules` / transform cache invalidation when a file or `tsconfig`/config changes, process-group kill on deadline/abort without corrupting Jest's cache or losing completed files in a batch (Spec 016 Kit K8).
3. **Closure, dependency graph, and module observation inside Jest's VM sandbox (CRITICAL):**
   - **Experiment on Jest's VM sandbox:** Jest executes test code via `jest-runtime` inside a `vm.Context` using its own module loader (`Runtime._loadModule` / `requireModule`), NOT Node's `Module._load`.
     - Verify by experiment what Squeal's existing `src/runners/observe/recorder.cjs` (`NODE_OPTIONS=--require`) DOES and DOES NOT capture under Jest in both `node` and `jsdom` environments:
       - Does it capture `fs.readFileSync`, `readdirSync`, `child_process.spawn`?
       - Does it miss `import`/`require` of project source modules inside `jest-runtime`?
       - What about `jest.mock(...)` / `__mocks__/` / `setupFilesAfterEnv` / `moduleNameMapper` / `tsconfig` paths / CSS-SVG mocks / snapshots (`__snapshots__/*.snap`)?
     - Test and compare mechanisms to observe EVERY module loaded by a Jest test file accurately:
       1. Custom Jest `resolver` (wrapper around Jest's default/project resolver, passed via `--resolver` or config override),
       2. Custom Jest `testEnvironment` / `jest-runtime` hook or `setupFiles` wrapper,
       3. Jest's built-in `SearchSource.findRelatedSourcesFromTestsInChangedFiles` / `--findRelatedTests` / `jest-haste-map` `DependencyResolver`,
       4. Static JS/TS import graph (extending `src/runners/node-test/graph/` with `tsconfig` paths + `moduleNameMapper` + `setupFiles`) combined with runtime observation (Spec 011 C3 + Spec 022 `loaded` strategy).
     - Verify whether a custom Jest resolver (or `DependencyResolver`) handles `moduleNameMapper`, `tsconfig` paths, `jest.mock`, dynamic `import()`, and re-exports, and check how fast it is on `saas-boilerplate`.
4. **Result reporting, check identity, failures, and coverage:**
   - Verify by experiment writing a tiny custom Jest reporter (`--reporters=<squeal-reporter>`) emitting JSON-lines per `onTestFileResult` (streaming file-by-file, not waiting for the whole run).
   - Check:
     - Exact check identity mapping (`file :: ancestorTitles + title` vs Vitest/node:test).
     - Collection / syntax / transform / setup errors (when `testResults` is empty and `testExecError` is set), skipped / `it.todo` / `describe.skip` / `.each` parametrized cases, snapshot mismatches, unhandled rejections, and `console.error` / open handles.
     - Does `onTestFileResult` flush cleanly before a deadline kills the batch, preserving completed files (Kit K8) while keeping cut/hung files `unknown`?
     - V8 coverage (`--coverage --coverageProvider=v8`): does Jest expose raw V8 coverage or Istanbul `CoverageMap` in `onRunComplete` / `testResults` compatible with Spec 015 (`CoverageRecord`), and what is the overhead?
5. **Environment identity, multi-project monorepos, and Squeal integration seams:**
   - What inputs must `environment()` hash so two worktrees with identical code and `pnpm-lock.yaml` share stored results (Decision 0002) while any config/dependency/transform/Node change re-keys cleanly? (Include root + project `jest.config.*`, `jest.preset.*`, `babel.config.*`, `tsconfig.*`, `setupFiles*`, installed Jest/transform/jsdom versions, `NODE_ENV`, `TZ`.)
   - Multi-project monorepos (17 projects in `saas-boilerplate`):
     - Measure memory and startup cost of loading root `jest.config.ts` (`getJestProjectsAsync()` -> all 17 projects) vs discovering and configuring individual project configs.
     - Recommend how `squeal.config.json` and `squeal setup` should represent single-project and multi-project Jest repos (including Nx repos where `jest.config.ts` uses `@nx/jest`'s `getJestProjectsAsync()`).
   - Check Squeal's Spec 016 seams (`src/core/types/runner.ts`, `src/runners/boundaries.test.ts`, `test/harness/shared/names-no-runner.test.ts`, `test/kit/`, CLI command interception for `jest`, `npx jest`, `pnpm nx run <pkg>:test`, and remote execution via Spec 026). Name any interface changes needed, or confirm `RunnerAdapter` fits unchanged.
6. **Recommendation and open questions for the human:**
   - Concrete architecture recommendation for `src/runners/jest/` + `test/kit/packs/jest.ts`, measured performance numbers, known Jest limitations (if any `KNOWN` gaps for the kit), rough wave breakdown, and open questions for the human before writing `spec.md`.
