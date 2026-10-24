# 015-11 notes: Squeal's coverage provider and the records

Row 015-11, spec 015 wave 2a, brief "W1: 015-11" in `../wave-2.md`. Spec sections: D8 (coverage), D1 and D4 (policy, code store), goals 9 and 10, 011 C7 (retention) and 011-23 (adoption).

## What changed

With `coverage.enabled` and `complexity.enabled`, each Vitest run the daemon makes anyway takes V8 precise coverage in its workers through Squeal's own provider. After the run's report, the adapter hands each completed test file's payload to a writer. The writer maps the payload, off the scheduler's path, to one record per test file and stores it in the code store at the test file's result key plus `COVERAGE_PROVIDER_VERSION`. A second worktree that adopts the result reads the same record, because the record is keyed by the result key. The record goes when the main store prunes its result.

No extra run, no project package, no report, nothing written into the worktree. With the policy off, the adapter passes `coverage: { enabled: false }` as 013-07 does, the instance's keys are byte-identical to today's, and no code store is opened.

## Seam map

| Piece | File | What it does |
| --- | --- | --- |
| Provider | `src/core/code/coverage/provider.mjs` | Dependency-free, loaded by path by Vitest in each worker and in the main process (`provider: "custom"`). Worker side: `startCoverage` opens a `node:inspector/promises` session and `Profiler.startPreciseCoverage({ callCount: true, detailed: true })`; `takeCoverage` writes the worker's `file://` scripts outside `node_modules`, each with the evaluator wrapper's `startOffset` from `moduleExecutionInfo`, to `coverage-<uuid>.json` in Vitest's coverage files directory; `stopCoverage` ends the session. Main side: keeps each batch `onAfterSuiteRun` gives (payload path, test files, environment, project) for `takeBatches()`; no report, `reporter: []`. |
| Skip | `provider.mjs`, `skip.json` | Before a run the adapter writes the test files that take no coverage to `<reportsDirectory>/skip.json`; a worker whose files are listed starts no session. `isolate: false` starts none either. |
| Instance options | `src/runners/vitest/coverage.ts` `InstanceCoverage` | One reports directory per Vitest instance under the daemon's temp directory (`coverage-XXXXXX`); D8's `createVitest` options; `take(vitest)` reads the provider through Vitest's internal `coverageProvider` getter. |
| Adapter | `src/runners/vitest/adapter.ts` | `#start` passes `InstanceCoverage.options()` when on, `{ enabled: false }` when off (013-07). `run()` writes `skip.json` (focused files and the inspector files), and after the report hands the clean run's completed, covered files to `collected`. `#invalidate` re-creates the instance when the policy flips. `close` removes the reports directories. |
| Executed sources | `coverage.ts` `coveredFiles`, `executedSources` | At the run's end, before an edit drops a transform: each project file the environment's module graph holds, with its transformed code, source map and the sha1 `SourceStamps` took of the bytes Vite read (`readHash`, new in `sources.ts`). |
| Mapping | `src/core/code/coverage/{ranges,sourcemap,map}.ts` | V8's nested block ranges flattened to the innermost count per offset (`Counts`); source map v3 VLQ decoding (`PositionMap`); each mapped position of the transformed code is a line that can run, covered when its innermost range ran; each V8 function by its start and end. |
| Record | `src/core/code/coverage/record.ts` | `buildRecord`: per source `{ path, blob, lines, covered, functions }`, lines as base64 bitsets of 0-based lines, functions as `[startLine, startColumn, endLine, endColumn, hit]` (1-based line, 0-based column). Deflated JSON. |
| Writer | `src/core/code/coverage/writer.ts` | Queues each run's files; maps one file per event-loop turn; looks up the result key at `RESULT_WAITS_MS` (0, 0.25, 1, 5, 30 s); stores; deletes each payload once read. Opens the code store at the first record. |
| Key join | `src/core/code/coverage/runtime.ts` `mainStoreResultKey` | The test file's key in `testFileKeys` for this worktree, accepted only when a stored result at that key names this run's ID. |
| Store | `src/core/code/store/coverage.ts`, `schema` in `store.ts` | Table `coverage(result_key, provider_version, record, recorded_at)`, primary key the first two; `get`, `put` (upsert). |
| Prune | `src/core/code/store/prune.ts`, `prune-main.ts`, `src/core/daemon/lifecycle.ts` | `pruneCodeStore` drops coverage rows whose result key is not among the main store's keys when `resultKeys` is given; `pruneCodeStoreAfter` runs after the main store's prune, only when the code store exists and the policy is on. |
| Daemon | `src/core/daemon/daemon.ts` | Creates the writer (`skip` = the provider file), passes `covering` to every Vitest instance, closes the writer after the code store's own close. |
| Keys | `src/runners/vitest/environment.ts` `canonicalConfig` | With Squeal's provider on, the instance's coverage block is replaced by `{ provider: "squeal", version: COVERAGE_PROVIDER_VERSION }`. |
| Bundles | `src/harness/build.ts`, `src/harness/opencode/build.ts` | `copyCoverageRuntime` copies `src/core/code/coverage/*.mjs` into `<outdir>/coverage/`, beside the observe recorder. `coverageProvider()` finds it at `../coverage/`, `./coverage/` or `./` from the running code. |

## Decisions the spec did not settle

1. **Keys (coordinator option A).** A coverage-on instance carries `{ provider: "squeal", version }` in its resolved config, which holds no path, temp directory or worktree value. Two worktrees and a bundled and a source daemon at the same version share keys. Coverage off is byte-identical to today (test: off equals no option). **Re-key:** turning coverage on re-keys every Vitest check once, and so does each raise of `COVERAGE_PROVIDER_VERSION`. This is right: those results gain a record. For the D8 amendment and the release notes.
2. **The record's key holds `COVERAGE_PROVIDER_VERSION` too** (D8), so a store read by an older or newer daemon reads no record of another meaning.
3. **The join by run ID.** A record is stored only when the test file's current key holds a result whose provenance names this run. A result withheld, or an edit that moves the file's key before the writer looks, drops the record (logged `coverage: no result of run <id> for <path>`). The next run makes it again.
4. **Which files leave a record.** A completed file of a run that did not hang, crash or get rejected. A focused file (some test names only) leaves none: its run is not the whole file's. A file with a fail or skip outcome still gets its record.
5. **Fidelity (D8).** A test file whose import closure holds `node:inspector` or `inspector` runs with coverage off, and the adapter notes "coverage is off for <path>: its closure imports node:inspector, so its tests can see V8 coverage (spec 015 D8)". The walk is `importClosure`'s builtins, at each run. A project with `isolate: false` gets one note and no coverage: one worker's payload cannot be split by test file.
6. **Closing punctuation is no line.** A position at `}`, `)`, `]`, `;` or `,` is skipped: V8 leaves the `}` after an early return outside the uncovered block, so it would read as run.
7. **Blob of the bytes run.** A source's blob is from the file now when its sha1 still equals the stamp Vite read, else from the map's `sourcesContent[0]` when that matches; else the path is listed in `unread` and has no entry. So a record never pairs lines with a blob they were not counted on.
8. **Functions.** V8 functions that start in the evaluator's wrapper or on code no source line maps to (what the transform added) are left out; two V8 functions at one source start are one entry, hit when either ran. A class field initializer is its own V8 function. A function V8 never compiled (lazy, its module never ran it) has no V8 entry, so it is absent rather than `0`; D9's reader must read absence as "not run" only for lines.
9. **`.gitignore`** line 3 `coverage/` became `/coverage/` (coordinator agreement): it hid `src/core/code/coverage/` from git and from Biome.

## Wave-0 gap

`pruneCodeStore` (wave 0) had no caller: code store counts were never pruned. This row adds the caller in `lifecycle.ts`, after the main store's prune, with the existing age rule for counts and the result-key rule for coverage records (coordinator agreement). Test: `test/code/coverage/prune-main.test.ts`.

## A coverage folder in the tree

No test writes a `coverage/` folder into the tree. The 013-07 test `own-coverage.test.ts` writes `coverage/` inside its fixture copy under `test/fixtures/vitest/.tmp/`, which `test/fixtures/vitest/.gitignore` ignores. Squeal's own provider writes only in the daemon's temp directory; `own-provider.test.ts` and `daemon.test.ts` check there is no `coverage/` in the root.

## Type changes (all additive)

- `CodeStore.coverage: CodeCoverageRepo` (new interface, `get`, `put`).
- `CodePruneOptions.resultKeys?: readonly CheckKey[]`.
- `VitestAdapterOptions.coverage?: VitestCoverage`; `VitestCoverage` exported from `src/runners/vitest/index.ts`.
- `EnvironmentContext.coverage?: AbsolutePath`; `canonicalConfig(..., coverage?)`.
- `SourceStamps.readHash(environment, id)`.
- New module `src/core/code/coverage/` with `CoverageRecord`, `CoverageSource`, `CoverageRun`, `CoveredFile`, `ExecutedSource`, `V8Script`, `ResultKeyOf`, `COVERAGE_PROVIDER_VERSION`, `RESULT_WAITS_MS`.

## Residue for the next worker

- **Copy across key formats.** `copyNewest` (a key format raise) copies results, not coverage records; a record re-made at the next run.
- **The inspector walk runs per run**, over each test file's closure. Cheap on this repository; a cache by closure revision would remove it.
- **Payload size.** A worker's payload holds every script it ran outside `node_modules`, so the files are large (hundreds of KiB) until mapped; they are deleted once mapped or on close.
- **Proposed D8 amendment text:** "Squeal's provider keys a coverage-on Vitest instance by `{ provider: "squeal", version: COVERAGE_PROVIDER_VERSION }` in place of the coverage block; turning coverage on, and each raise of that version, re-keys Vitest checks once. A record is stored only for a clean, unfocused run's completed test file whose result at its current key names that run. A test file whose closure imports `node:inspector` runs with coverage off, as does each `isolate: false` project, with a note."
