# 018-38 notes: a run log is written only while Squeal's store folder exists

## Seam map

- Every production `RunOptions.logDir` sits under a `runs` folder: the scheduler's `<store>/runs/<run-id>` (`tiers.ts`, `newTier`), a remote lane's local `<run>/here` (`runner-host/remote/lane.ts`), the code gate's `<temp>/runs/<i>` (`core/code/gate/collect.ts`), a remote host's `<state>/runs/<id>` (`tree-host.ts`, made before the run). node:test and pytest log one level deeper, `<run>/node-test/<project>` and `<run>/pytest/<project>` (their adapters join it).
- `src/runners/log-dir.ts`, `makeLogDir`: the store is the parent of the nearest `runs` above the folder; each missing level below it is made by a plain `mkdirSync`, so a removed store gives ENOENT on the first level and nothing is made. A folder with no `runs` above it (unit tests, the validity harness's `<scratch>/logs/<at>`) is made the same way below the nearest folder that exists, so the validity cases run the loop every production run takes.
- Vitest makes its log folder only at the end (`run.ts`, `writeRunLog`), so a cancelled run's late log is the path review 018-37 reproduced. It now writes no log when `makeLogDir` says the store is gone; nothing else of the run needs the folder.
- node:test (`runNodeTest`) and pytest (`runPytest`) make their folder at the start, and their processes write their records there. A run a host starts after its daemon died reaches the same mkdir: it now starts nothing and returns `logGoneReport` (crashed, nothing completed).
- When their folder goes while they run, both check it once their processes ended and return `logGoneReport` too. node:test reads each completed file's graphs (its observed closure) only at the end, so a quiet skip there would store a result under a key missing those loads; the last release threw ENOENT and stored nothing. The late writes (`run.json`) are the release's again.

## Decisions the brief did not settle

1. The store is found by the folder name `runs` (001 D1's layout), not passed in: the runner host builds `RunOptions` from the wire (`src/core/runner-host/*`, not this row's), so an added field could not reach it.
2. node:test and pytest report `end: "crashed"` with `Squeal's run log folder <dir> is gone; the run reports nothing`, and pytest no note. Their daemon is gone in the case this row fixes, so nothing reads the report.
3. Vitest skips its log quietly; `collector.logFile` stays `null`, so a later `note` stays in memory.
4. A folder removed between the end check and the `run.json` write still throws ENOENT, as at the last release; no folder is made.

## Key-format guard (coordinator, 2026-11-12: cases, no adapter raise)

The guard bundles all components into one bundle and counts a line as run when any case runs it. The changed lines no case ran were `logGoneReport`'s body and pytest's `logGone`; the one-line checks run in every case. Cases added, each over a store or log folder that goes:

| Case | Kind | At the candidate | At `squeal--v0.1.443` |
| --- | --- | --- | --- |
| a stopped run under a store that is gone (after a run under a store that is there) | `adapter:node-test` | makes no folder, reports nothing | makes the folder again, starts nothing |
| a run whose log folder goes while it runs | `adapter:node-test` | reports nothing | throws ENOENT (`scandir`) at the graphs: `lastThrows` |
| a stopped run under a store that is gone | `adapter:pytest`, Python 3.13 | makes no folder, reports nothing | makes the folder again, starts no batch |
| a run whose log folder goes while it runs | `adapter:pytest`, Python 3.13 | reports nothing | throws ENOENT (`open`) at `run.json`: `lastThrows` |
| a run, and a cancelled one, under a store that is gone | `adapter:vitest` | writes no log | makes the folder again for its log |

- The harness gains `storeGone` on a run of each adapter kind: the run logs into `<scratch>/gone/runs/<at>`, which is not there; node:test's and pytest's runs are stopped too (`RunOptions.stop` aborted), as a host stops a run once its daemon died. Without the stop, the last release would run the files and store them where the candidate starts nothing.
- The mid-run cases' test files remove `<scratch>/logs` by its place beside `<scratch>/worktree`.
- `lastThrows` (row 011-310) now also names a throw at a run whose log folder went; the verdict reads it as before. The last release stores nothing of such a run.

## Residue

- Not changed: node:test's `coverageEnv` (`run/coverage.ts`) and `NodeTestReads.start` (`run/reads.ts`) still `mkdirSync(..., { recursive: true })` one level inside the log folder. `NodeTestReads.start` runs right after `makeLogDir`. `coverageEnv` runs as each file starts, so a file started after the store was removed and before the run's stop could make the store again. Not measured: whether a host's stop always comes before a teardown's removal.
- Not changed, child processes: the node:test recorder and the pytest plugin append to files in the log folder and make no folder. Node itself makes `NODE_V8_COVERAGE`'s folder when a covered file's process exits normally; that folder is inside the log folder (`cov-<i>`), so such an exit after a removal could make it again. Not probed.
- Not changed: Vitest's `RunCollector.note` appends to the log after `writeRunLog`; with the folder gone it emits a process warning (no folder is made).
- Complexity: `runPytest` went from 24 to 26 (Squeal's ESLint rule, threshold 20; lint does not gate it). `runNodeTest` is 18: its recorder signatures moved to `signed`.
- A linked worktree's run logs live in the common Git directory, so removing a linked worktree leaves its store and its logs are still written (review 018-37, next-wave input 3).
