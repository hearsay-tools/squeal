# 018-38 notes: a run log is written only while Squeal's store folder exists

## Seam map

- Every production `RunOptions.logDir` sits under a `runs` folder: the scheduler's `<store>/runs/<run-id>` (`tiers.ts`, `newTier`), a remote lane's local `<run>/here` (`runner-host/remote/lane.ts`), the code gate's `<temp>/runs/<i>` (`core/code/gate/collect.ts`), a remote host's `<state>/runs/<id>` (`tree-host.ts`, made before the run). node:test and pytest log one level deeper, `<run>/node-test/<project>` and `<run>/pytest/<project>` (their adapters join it).
- `src/runners/log-dir.ts`, `makeLogDir`: the store is the parent of the nearest `runs` above the folder; each missing level below it is made by a plain `mkdirSync`, so a removed store gives ENOENT on the first level and nothing is made. A folder with no `runs` above it (unit tests, the validity harness's `<scratch>/logs/<at>`) is made the same way below the nearest folder that exists, so the validity cases run the loop every production run takes.
- Vitest makes its log folder only at the end (`run.ts`, `writeRunLog`), so a cancelled run's late log is the path review 018-37 reproduced. It now writes no log when `makeLogDir` says the store is gone; nothing else of the run needs the folder.
- node:test (`runNodeTest`) and pytest (`runPytest`) make their folder at the start, and their processes write their records there. A run a host starts after its daemon died reaches the same mkdir: it now starts nothing and returns `logGoneReport` (crashed, nothing completed).
- When their folder goes while they run, or is made again, both see it by the folder's mark (`markLogDir`, repair R1 below) before each file or batch and once their processes ended, and return `logGoneReport` too. node:test reads each completed file's graphs (its observed closure) only at the end, so a quiet skip there would store a result under a key missing those loads; the last release threw ENOENT and stored nothing. The late writes (`run.json`) are the release's again.

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

- Not changed: Vitest's `RunCollector.note` appends to the log after `writeRunLog`; with the folder gone it emits a process warning (no folder is made).
- Complexity: `runPytest` went from 24 to 26 (Squeal's ESLint rule, threshold 20; lint does not gate it). `runNodeTest` is 18: its recorder signatures moved to `signed`.
- A linked worktree's run logs live in the common Git directory, so removing a linked worktree leaves its store and its logs are still written (review 018-37, next-wave input 3).

## Repair R1 (review 0.1.449 B1)

B1: a covered node:test process makes its `NODE_V8_COVERAGE` folder, parents and all, as it exits (Node's `MKDirpSync`, before writing the profile). A store removed while a run held its second file came back with the log folder, so the end's `existsSync` passed and the first file's pass was reported with its graphs lost; removing only the log folder did the same.

- **Coverage destination** (`run/coverage.ts`): `coverageEnv(dir, link, covering)` makes `<logDir>/cov-<i>` by `makeLogDir` and points `NODE_V8_COVERAGE` and the recorder's `SQUEAL_NODE_TEST_COVERAGE` at `link`, a symbolic link to it in a folder of the run's own under the OS temp directory (`CoverageLinks`, made at the first covered file, removed once the run's processes ended). Probed on Node 22.19, 24.22 and 26.13: through a dangling link Node prints `ENOENT: Failed to create coverage profile directory <link>` on the process's stderr, exits 0 and makes nothing; `<link>/children` (020 D12) does the same. With the store there, the payloads land in `<logDir>/cov-<i>` as before, so `coveragePayloads`, the coverage writer and pruning read them where they did. A link is `junction` on Windows, which CI does not run.
- **Lost records** (`log-dir.ts`, `markLogDir`): the folder `makeLogDir` made gets `run.mark`, a token of the run's own. node:test and pytest check it before each file or batch starts and once their processes ended; a folder removed, or removed and made again, starts nothing more and reports nothing (`logGoneReport`). It replaces the end's `existsSync`.
- **Other recursive creators**: `coverageEnv`'s `mkdirSync(dir, { recursive: true })` is gone (above). `NodeTestReads.start` (`run/reads.ts`) is unchanged: it makes `reads/` in the same synchronous turn right after `markLogDir` made and marked the folder, before any process starts, and the observe recorder only appends to files in it (`recorder.cjs`, `appendFileSync`). Only a removal by another process between those two statements could let it make the store again, and the mark then rejects the run. Making it non-recursive would change a line no validity case runs (no case runs a node:test warm-up, `observeIgnored`), so it would need a harness field and a case; not done.
- **Not covered**: a process a test starts that outlives its test file's process writes its coverage after the run removed the links folder, so Node makes `<tmp>/squeal-coverage-*/cov-<i>/children` again under the OS temp directory (never the store). Before R1 it wrote into the log folder.
- **Key-format guard**: every changed line runs in the existing cases (the coverage cases run the link, the mid-run removal case the mark's failed read). R1 claimed a covered removal case differs from the last release only where the store was removed; that was wrong. Removing only the log folder leaves the store in place, and the last release then stores the first file's pass without its loads under unchanged keys (re-review of 0.1.449, B1). So `NODE_TEST_ADAPTER_VERSION` rises to 11 (the human, 2026-11-12: "A: raise version"), with the covered log-folder-only case as the case that stands for it (`cases/adapter/node-test.ts`): results stored that way are no longer found.
- Tests: `test/runners/node-test/run-log-gone.test.ts` (the review's reproduction: store removed, log folder removed, a queued third file; and a covered run under a store that is there still writes `cov-0` and `run.json`), and run-cut's remade-folder case for pytest. Each failed at `9ed332b11` and passes after.
