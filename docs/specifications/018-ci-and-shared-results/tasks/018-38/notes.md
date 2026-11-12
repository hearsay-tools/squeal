# 018-38 notes: a run log is written only while Squeal's store folder exists

## Seam map

- Every production `RunOptions.logDir` sits under a `runs` folder: the scheduler's `<store>/runs/<run-id>` (`tiers.ts`, `newTier`), a remote lane's local `<run>/here` (`runner-host/remote/lane.ts`), the code gate's `<temp>/runs/<i>` (`core/code/gate/collect.ts`), a remote host's `<state>/runs/<id>` (`tree-host.ts`, made before the run). node:test and pytest log one level deeper, `<run>/node-test/<project>` and `<run>/pytest/<project>` (their adapters join it).
- `src/runners/log-dir.ts`, `makeLogDir`: the store is the parent of the nearest `runs` above the folder; each missing level below it is made by a plain `mkdirSync`, so a removed store gives ENOENT on the first level and nothing is made. A folder with no `runs` above it (tests, the validity harness's `<scratch>/logs/<at>`) is made level by level below the nearest folder that exists, as a recursive mkdir would.
- Vitest makes its log folder only at the end (`run.ts`, `writeRunLog`), so a cancelled run's late log is the path the review reproduced. node:test (`runNodeTest`) and pytest (`runPytest`) make theirs at the start; a run a host starts after its daemon died reaches it the same way. They now return `storeGoneReport` (crashed, nothing ran) and start no process.
- Late writes: `writeLog` writes nothing on ENOENT (Vitest's `vitest.log` and `report.json`, node:test's and pytest's `run.json`). node:test's `graphs` reads nothing once the folder is gone. Before, a run whose folder was removed while it ran threw ENOENT (no folder was made, since `writeFileSync` makes none).

## Decisions the brief did not settle

1. The store is found by the folder name `runs` (001 D1's layout), not passed in: the runner host builds `RunOptions` from the wire (`src/core/runner-host/*`, not this row's), so an added field could not reach it.
2. node:test and pytest, when the store is gone at the start, report `end: "crashed"` with `Squeal's store folder above the run log folder <dir> is gone; nothing ran`, and no pytest note. Their processes write into the log folder, so they cannot run without it. Their daemon is gone in the case this row fixes, so nothing reads the report.
3. Vitest skips its log quietly; `collector.logFile` stays `null`, so a later `note` stays in memory.

## Residue

- Key-format guard (`test/keys/key-format.test.ts`, "moves only when ..."): fails, naming `VITEST_ADAPTER_VERSION`, `NODE_TEST_ADAPTER_VERSION` and `PYTEST_ADAPTER_VERSION` for changed lines no case runs. All of them run only when the store or the log folder is gone: `writeLog`'s catch and `storeGoneReport` (`log-dir.ts`), node:test's `graphs` catch, pytest's store-gone return. No case differs. The loop every run takes runs in the existing cases since commit `489db377d`. A validity case that removes the store would differ for node:test and pytest (the last release recreates the folder and runs; this one reports crashed), though nothing is stored then.
- Not changed: node:test's `coverageEnv` (`run/coverage.ts`) and `NodeTestReads.start` (`run/reads.ts`) still `mkdirSync(..., { recursive: true })` one level inside the log folder. `NodeTestReads.start` runs right after `makeLogDir`. `coverageEnv` runs as each file starts, so a file started after the store was removed and before the run's stop could make the store again. `runNodeTest` starts no file after a stop. Not measured: whether a host's stop always comes before a teardown's removal.
- Not changed, child processes: the node:test recorder and the pytest plugin append to files in the log folder and make no folder. Node itself makes `NODE_V8_COVERAGE`'s folder when a covered file's process exits normally; that folder is inside the log folder (`cov-<i>`), so such an exit after a removal could make it again. Not probed.
- Not changed: Vitest's `RunCollector.note` appends to the log after `writeRunLog`; with the folder gone it emits a process warning (no folder is made).
- `runPytest` complexity went from 24 to 25 (Squeal's ESLint rule, threshold 20; lint does not gate it). `runNodeTest` is at 20.
- A linked worktree's run logs live in the common Git directory, so removing a linked worktree leaves its store and its logs are still written (review 018-37, next-wave input 3).
