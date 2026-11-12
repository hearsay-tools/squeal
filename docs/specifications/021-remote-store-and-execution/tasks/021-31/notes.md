# 021-31 notes: an incremental code-quality pass

Worker d056771a, 2026-11-12. Spec 021 D21.4; `../../research/daemon-heap.md` Q1 ("What allocates while busy").

## What changed

- `src/core/code/crap/loader-map.ts` (new), `LoaderMap`: each source's loaders, kept across reads. A read places every listed test file again (`place`). A test file whose closure and condition stay touches nothing. One whose condition changed moves the sources it loads. One whose closure changed leaves its old sources' lists and joins its new ones. One no longer listed leaves at `end`. `moved()` gives the sources that moved since the last call, or `"all"` (the first read, a test file with no closure here came or went, the worktree's listing became empty or not). It also keeps each source's `loaderSet`, made again only when the test files in that source's list change.
- `loaders.ts`, `LoaderBuild`: reads into the map it is given, one test file per unit as before (row 015-45). It gives the map out only once every row is read, as before.
- `cache.ts`, `StepCache`: owns the map. `invalidate()` no longer clears the conditions, signatures and early signatures. When a read is whole, `#forget` drops only those of the moved sources. `keep(files)`, called by the step after each walk, drops those of sources the step no longer judges (a revision removed or renamed them). Without it they would grow for the daemon's life, as `invalidate()` no longer clears them.
- `file.ts`, `fileCondition`: one loop over the loaders instead of four `flatMap`s and a `Set`; the loader set comes from the map.
- Tests: `test/code/crap/loader-map.test.ts`. A read after one stored record moves only that test file's sources. A source's condition is made again only when its loaders moved. Through 13 kinds of change, the kept map gives each source the same loaders, `withoutImports`, `listed` and loader set as a read from scratch. `keep` forgets removed sources only once there are more conditions than judged files. All 42 files in `test/code/crap/` pass unchanged.

## Seam map

- Who invalidates: `src/core/code/pass/index.ts`. `soon()` (after each stored record through the writer's `onStored`, `daemon.ts:799`, and after each batch of results through `afterResults`, `daemon.ts:884`) calls `cache.invalidate()` at once. So do a revision (`coverageStep`), a record wait's wake (`retryLater`) and `shut()`. None of them says what changed. The map finds it by reading every row again and comparing.
- What a row's loader depends on: the row (`testFileKeys.list`), the key index (`closures.key`, `closures.closure(...).paths`, `closures.environment(project)`), the results at the key, the record's `storedAt`, `now` and `writing`. `KeyIndex.closure` returns the stored `Closure`, so its `paths` array keeps its identity until `setClosure` replaces it. `keying.ts` `environmentFiles` returns the stored array too. So the common case is an identity check. A replaced closure with the same paths is compared element by element and moves nothing.
- What a source's condition and signature read of its loaders (`fileCondition`, `loaderSet`, `signatureOf`): each loader's test file, kind, key, `storedAt`, pending reason, unknown cause and runner. Not a pending one's `until`, which only the read's `wakeAt` takes.

## Decisions the spec did not settle

1. **Changed test files are found by reading every row again, not by a key carried in the notification.** Carrying the stored record's key through `onStored` and `soon()` would touch `writer.ts`, `pass/index.ts` and `daemon.ts`, outside this row. The per-row reads were already made at each read. What goes is the walk over every closure path and the remaking of every source's condition and signature.
2. **A pending loader's `until` does not move its sources.** With the writer busy, every result waiting for its record gets `until: now + 5 s` at each read (`BUSY_RECHECK_MS`). Moving their sources would remake them at every read, in exactly the busy case this row is for. `wakeAt` still takes the earliest `until` at each read.
3. **The order of a source's loaders can differ from a read from scratch.** A test file that moved is at the end of its sources' lists. Every reader is order-free: `loaderSet` and `signatureOf` sort, `joinCoverage` uses `some` and sorts `runBy`, `coverageOf`'s `unread` is any-of. The from-scratch test compares sorted lists.
4. **A test file's loader object is changed in place** (`Slot`), so a moved condition costs no walk over its sources' lists. `of(path)` returns the live list. Nothing keeps it past one `fileCondition` call; `FileCondition` copies the ready loaders.
5. **`keep` looks only when there are more conditions than judged files.** It then makes one `Set` of the judged paths. In the common case it does nothing.

## Type changes (all inside `src/core/code/crap/`)

- `Loaders` gains `set(path)`: the source's `loaderSet`.
- `new LoaderBuild(inputs, map)` takes the map. `StepCache.loaders(start, work)`: `start` receives the map.
- `StepCache.keep(files)` is new. `fileCondition(loaders, listed, set?)` takes an optional `set`.
- No caller outside `crap/` constructs `LoaderBuild` or reads `Loaders`.

## Allocation, before and after

`alloc.probe.ts` with `vitest.probe.config.ts`, one process, no daemon. The fixture: the coverage rig with 600 counted sources and 400 test files. Each test file loads 150 sources (sorted, fixed pseudo-random) and has a record. A first step with a kept `StepCache` judges every source; a second settles. Then for 20 rounds: one test file gets a new key, result and record (what a run then its record store), `cache.invalidate()` (what `soon()` does), and steps until none is left. V8's sampling heap profiler (512-byte interval, objects collected by major and minor GCs included) runs only around the steps. "Kept" is the heap in use after a GC with the cache, less the heap in use after a GC without it. Before: `02e286d10`, a detached worktree of the base with this probe copied in. After: `af709eafb`. Load average 17 to 19 (the host's own load), Node 26, Vitest 5.0.3.

| Fixture | Before, MiB per stored record | After | Change | Kept between chains, before → after |
|---|---|---|---|---|
| Each test file loads 150 of 600 sources at random | 45.15 | 15.90 | −65% | 4.37 → 4.43 MiB |
| As above, with 50 sources every test file loads (a shared core) | 51.05 | 24.56 | −52% | 4.42 → 4.47 MiB |

Where it went (MiB per round, by the deepest frame in `src/`, random fixture):

| Before | | After | |
|---|---|---|---|
| `signatureOf` (every source) | 6.51 + 3.68 | `signatureOf` (moved sources) | 1.68 + 0.96 |
| `fileCondition` and its `flatMap`s | 1.59 + 5.99 + 1.84 + 1.83 | `fileCondition` (moved sources) | 1.58 |
| `loaderSet` | 4.44 + 1.84 | kept per source | 0 |
| `LoaderBuild.#read` (the map over every closure path) | 3.71 | kept map | not in the top 15 |
| store reads (`connection.ts` `all`, `get`) | 1.62 + 0.67 | the same | 1.63 + 0.67 |

The first step after a start, a recount or a change of the worktree's listing still reads the whole map and makes every source's condition, as before.

How to run it (from the worktree root, one process; `ROUNDS`, `SOURCES`, `TESTS`, `CLOSURE`, `HOT` change the fixture):

```sh
HOT=50 node_modules/.bin/vitest run --silent=false --reporter=verbose \
  --config docs/specifications/021-remote-store-and-execution/tasks/021-31/vitest.probe.config.ts
```

## What is left (not in this row)

- **Store reads per read.** Each read lists every row and makes one `coverage.storedAt` read per ready row and a `results.byKey` read per row not settled: 2.3 MiB of the 15.9 per round. Two ways to remove them: one query for every key's `storedAt`, or the stored key carried by `onStored`. Both are outside `crap/` (`code/store`, `pass/index.ts`, `coverage/writer.ts`).
- **A shared core is judged again at each record.** A record of a test file that loads a shared source makes that source's condition, signature and join again over all its loaders' records. That is O(loaders) per shared source, and most of what is left in the second fixture. It is the work row 015-12 asks for: judge again when a record is stored. Holding the coverage step while a queue drains, the research's other option, would cut it.
- **The summary per step.** `runCoverageStep` parses the summary (`readSummary`) and compares `JSON.stringify` of it with the one it writes, both O(sources), at each step. It was small at 600 sources (not in the top 15). It grows with the source count. Not measured on cezar.
