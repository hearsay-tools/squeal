# Row 022-03: notes (recorder, union, loaded-list table)

## Seam map

| Step | Where | What |
| --- | --- | --- |
| Record (D1) | `src/core/code/coverage/provider.mjs` `loadedFiles` | `takeCoverage` returns `{ file, loaded }`. `loaded` is the files of `__vitest_worker__.evaluatedModules.idToModuleMap` by node presence: `mock:` cut, `file://` read, query and hash cut, non-absolute ids, `/node_modules/` and the provider itself dropped. The main side's `onAfterSuiteRun` keeps `coverage` a path string, so the CI runtime (`ci-runtime/coverage.cjs`, through `takeBatches`) reads batches unchanged. |
| Keep (D1) | `src/runners/vitest/coverage.ts` `loadedLists` | One list per single-file batch of a wanted file, the worktree's project files only, sorted. A list without its own test file is dropped as lost. |
| Pick (D1) | `src/runners/vitest/adapter.ts` `#withLoaded` | Clean runs only, the files `#collect` picks, less a file with a file error and no result (a failed load: its worker still calls `takeCoverage` from `onAfterRunFiles`). |
| Join (D2) | `src/runners/vitest/observe.ts` `withLoaded` | Only when `report.observed` is there (the observer runs, policy `observe.runtimeInputs`). Each list's paths, less the project's environment files from the last `environment()` answer, join `paths` and `modules`. The core's `observedGrowth` (`src/core/scheduler/observed.ts`) drops the closure's paths as for any observed path. |
| Carry | `RunReport.loaded` (`src/core/types/runner.ts`), merge rule `listedWhenFound` (`src/core/daemon/report-merge.ts`) | Additive. Remote runs carry it as JSON. |
| Store (D3) | `src/core/scheduler/record-tier.ts` `storeLoaded` → `writeLoadedModules` | At the key the results are stored under, each path with `keys.cache.hashOf` now; an untracked or gone path is left out. Lists are stored with policy `observe.runtimeInputs` off too. |
| Prune (D3) | `src/core/store/prune.ts` → `dropOrphanLoadedModules` | After the results' drop and the size cap: lists whose key has no result, `DELETE_BATCH` per slice. |

## Measured on Vitest 5.0.3

- A factory-mocked module (`vi.mock(path, factory)`) has a node in the map, so it is in the list, though it never ran. A list may hold more than ran, never less. Phase 2 must not read the list as "what ran".
- A failed import is in `completedFiles` with a file-level error and no result; the core calls that phase `load` (`src/core/scheduler/records.ts`).

## Key-format alarm

`test/keys/validity` gained an `observe` input for the `adapter:vitest` kind (the adapter's fourth argument at both trees) and a `loadedLists` input for the `prune` kind (the table made by SQL; what the prune leaves is wording, since no key reads it). The two cases run the new lines with equal outputs, so no format or adapter raise.

## Left for later rows

- Phase 2 (D5) reads `loaded_modules` at a file's previous key.
- node:test lists (open question 3): its recorder's module loads already reach `observed`; a `loaded` list from it would need a runner-side list per file.
