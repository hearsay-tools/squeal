# 015-42 notes: coverage work caps its share of the daemon's main thread

Worker c9034b32, 2026-10-25. Brief: `tasks/wave-4.md` W1, from 011-197's findings (`docs/specifications/011-core/tasks/011-197/findings.md`, recommendation 2). Starts from main after 0.1.302 (`199b4e89b`), coverage off in `squeal.config.json`. The line in `src/harness/build.ts` and the bundle tests' new file were agreed with the coordinator (reply to request `2a2bc9ee`, option a).

## What changed

- **The coverage step's chain** (`crap/cache.ts`, `crap/step.ts`, `pass/index.ts`). A `StepCache`, held by the code pass, keeps the loader map, each source's condition and each signature until results, records, a revision or a wake change them. It keeps the decoded records until the chain ends. The step's budget counts from the step's start, so the reads count in it. Each record decoded and each file judged is one unit of work. A step past its budget does one unit, so a chain always moves.
- **Pacing** (`coverage/pace.ts`). A coverage step, or a writer job, that took `d` ms on the main thread starts its successor no sooner than `d` ms after it ended. This holds for `soon()`, the `more` chain, wakes and revisions. A recount whose step waits keeps its reseed for that step.
- **The records' writer** (`coverage/writer.ts`, `mapper.ts`, `map-worker.ts`). A worker thread reads, parses and maps each payload. The main thread posts the payload's path, gives the sources that the payload's scripts name, and stores the record. The worker keeps the sources of the newest two runs and asks again for an older one. The worker stops when the queue empties. Without a worker script (TypeScript sources), or after a worker failed (told once), each payload is mapped on the main thread and paced. The main thread deletes each payload once the worker answered for it, so the job a failed worker held is mapped on the main thread and its record is not lost (review 0.1.305 B2: the first version let the worker delete the payload when it read it, and a worker that exited on its `sources` message lost that job's record).
- **Bundle** (`src/harness/build.ts`, by agreement): `cli/coverage-map.mjs` beside the CLI in every plugin. The `tsc` build has `dist/core/code/coverage/map-worker.js` beside `mapper.js`.

Records are byte-identical. `buildRecord` gets only the sources it was given. A path that is skipped, or not among the run's sources, has no entry on either path. `COVERAGE_PROVIDER_VERSION` and the record are unchanged. `writer-worker.test.ts` compares the worker path and the main-thread path with `encodeRecord(buildRecord(...))`, The same test passed against a trial esbuild bundle of `map-worker.ts` in scratch (2 of 2), not committed.

## The 01:09 to 01:27 load

**The writer drained at 01:09, as the findings say. The load was the code pass's coverage chain.**

- The code store copy (`/tmp/r197/code`), records stored per minute: 200, 200 and 126 from 01:01 to 01:03, each 0 to 41 s after its result. Then 41 from 01:04 to 01:09, 48 to 357 s after their results, all of one run: 126 + 41 = 167, the last tier. Then none until new runs at 01:25. So from 01:04 each writer job waited about 8 s for its turn. That was the loop's iteration time, not the map's: on this host a synthetic payload of 9 to 27 MiB maps in 0.23 to 0.76 s at load 40.
- The chain on the 01:25 main store copy with the code store copy, from a recount (`bench/chain.ts` in scratch, not committed), at nice 10: it **did not finish in about 40 minutes**. The bench was stopped at its time limit, load 24 to 54. In a 90 s window it made 155 steps and judged 229 of 1,263 files, about 1.5 per step: median step 410 ms, longest 2,011 ms, RSS 1,154 MiB.
- The profile of those 90 s: record reads and decodes (SQLite `get`, inflate, `JSON.parse`) 45%, garbage collection 20%, `readLoaders` 15%, `signatureOf` 9%. All of it was outside `STEP_BUDGET_MS`, and all of it was done again at each step, because the records' and loaders' caches lived for one step. The first file a step judged decoded the records of all its loaders (up to about 1,000), so the budget was spent before the second file.
- The probe test, `test/code/crap/chain-load.test.ts` (`monitorEventLoopDelay`), makes the same shape synthetically: 200 sources, each loaded by 300 test files.

## Times before and after

All runs at `nice -n 10`, on a host with 24 CPUs that other coordinators loaded. The one-minute load average is given for each run. Timing assertions skip above load 8, like the other timing tests, so every run here skipped its assertion and printed its numbers.

| Measure | Before (main after 0.1.302) | After | Load before / after |
| --- | --- | --- | --- |
| Coverage chain, 011-197's 01:25 stores, from a recount | not finished after about 40 min; 1.5 files per step, median step 410 ms | finished: 1,069 judged in 173 steps, 57.6 s, of which 28.7 s main thread (50%); median step 109 ms. A second run: 102 steps, 22.1 s, 11.1 s main thread, median 87 ms | 24 to 54 / 40 to 54, 47 |
| First step of that chain (cold loader read) | (each step re-read) | 7,162 ms, then 1,930 ms in the second run | — / 40 to 54, 47 |
| `chain-load.test.ts`: 200 sources × 300 test files, judged | 92.8 s, longest turn 1,208 ms (an earlier run: 49.2 s, 510 ms) | 2.9 s, longest turn 88 ms | 50.7 (25.8) / 32.4 |
| `writer-turns.test.ts`: one 26.9 MiB payload stored, longest main-thread turn | 747 ms | 54 ms (an earlier run: 58 ms) | 28.4 / 28.4 (40.2) |
| `writer-feed.test.ts` (011-197's test): reconciliation pass of 2,000 tracked paths, alone and beside 12 payloads of 421 to 531 ms each | 164 ms alone, 2,036 ms beside (12.4×) | 135 ms alone, 223 ms beside (1.65×; the bound is 3×) | 31.0 / 30.6 |

The red runs of each new test on the baseline used a detached copy of `199b4e89b` in scratch: `chain.test.ts` (3 of 3 fail), `writer-pace.test.ts` and the timing tests above. `writer-worker.test.ts`'s byte-identity test is green on both by design. Its second test, the failing worker, is red on the baseline, which has no worker to fail.

## Tests

- `test/code/crap/chain.test.ts` (fake timers): the loader map is read once over a chain and again after results and after a revision. A step's successor waits the step's own time, after `soon()` too. Each record is decoded once over a chain, each decode inside the budget.
- `test/code/crap/chain-load.test.ts`: the probe test above, with the longest turn under 100 ms (skipped when loaded).
- `test/code/coverage/writer-worker.test.ts`: worker and main thread store the bytes `buildRecord` gives: a skipped provider, a script outside the run's sources, a source read from its map's `sourcesContent`, an `unread` one, and files that move between three sources maps, so the worker asks again. A worker that fails at load is told once, and both records are still stored. A worker that exits on the sources it asked for loses no record, and no payload is left (B2).
- `test/code/coverage/writer-pace.test.ts` (fake timers, main thread): each job waits the job before's own time.
- `test/code/coverage/writer-turns.test.ts`, `writer-feed.test.ts`: the timing tests above (skipped when loaded).
- `test/code/coverage/mapper.test.ts`: the worker script lookup, as `desk.test.ts` does for the front desk.
- `test/harness/codex/plugin.test.ts` (fresh build: one bundle more) and `test/harness/plugin.test.ts` (the committed dist ships `cli/coverage-map.mjs`), by agreement.

## Seam map

| Piece | File | Note |
| --- | --- | --- |
| Step cache | `crap/cache.ts` `StepCache` | `loaders`, `condition`, `signature` (by blob, counter version and threshold), `record`, `decode`; `invalidate` (map, conditions, signatures; each record is read again before its next use), `settle` (records). `signatureOf` moved here from `step.ts`, unchanged. |
| Budget, walk | `crap/step.ts` `budget`, `walk` | `runCoverageStep` reads through `input.cache`, or a fresh one when none is given. |
| Pass | `pass/index.ts` | `cache.invalidate()` in the `soon` and wake timers, after a revision, and at `shut`; `cache.settle()` when a step ends the chain; `paced()` replaces `setImmediate`; `reseedDue`. |
| Pace | `coverage/pace.ts` `Pace` | `measure`, `due`, `wait` (writer), `after` (pass, unref'd), `cancel`. |
| Mapper | `coverage/mapper.ts` | `mapWorkerScript`, `mapHere` (015-11's mapping), `threadMapper`, `workerMapper`; messages `ToWorker`, `FromWorker`. |
| Worker | `coverage/map-worker.ts` | `job` → `need` → `sources` → `record` or `error`; `KEEP` = 2 runs. |
| Writer | `coverage/writer.ts` | `mapOf`, `failed`, the paced `loop`; `worker` option. |

## Decisions the spec did not settle

1. **One unit past the budget.** A step always does one unit of work, a record decoded or a file judged, so a chain moves even when its reads spent the budget. Without a cache (`rig.step`, a bench), a step whose reads spend the budget decodes the same first record at every call. Only the code pass repeats steps, and it passes its cache.
2. **Records outlive an invalidation within a chain while their bytes stay.** Results or a revision drop the loader map but keep the decoded records. A later run at a key stores its record over the first, so after each invalidation a decoded record is read again and its bytes' sha1 compared; it is decoded again only when they moved (review 0.1.305 B1, which proved the first version, which kept them unread, wrong). The records go when a step ends the chain or the store closes. The peak is the same as before, when one step held the records of every loader of the file it judged. RSS in the real-store bench: 503 to 521 MiB after, 1,154 MiB before.
3. **What drops the loader map:** `soon()` (results or records stored), a revision (a pass report), a wake (a record wait that ends), and the store closing. The `more` continuation does not.
4. **Pace counts recent work.** Work measured before the last wait ended adds to the next wait, as the worker path's message handlers and its store do for one job. Work after it starts a new window.
5. **The worker gets sources on demand,** not a run's whole module graph, and keeps two runs. The record comes back copied, not transferred, because the deflated buffer can share a pool. A record is small next to its payload; its copy time was not measured on its own.
6. **The worker stops when the queue empties,** so it holds no memory between runs. It starts again at the next run's first job. The start time was not measured on its own; it is inside the worker-path times above.
7. **The probe must tick before the turn it times.** `monitorEventLoopDelay` reports a delay only between two of its own ticks. `writer-turns.test.ts` lets it tick for 30 ms first; without that, the baseline printed 0 ms for a 624 ms turn.

## Proposed amendment lines (the coordinator folds them in)

- D8 Mapping: "Each payload is mapped in a worker thread beside the daemon (row 015-42); the main thread gives the sources a payload names and stores the record. Without a worker (from the TypeScript sources, or after one failed) the main thread maps it, and each job waits its own main-thread time before the next."
- D9 or D4, the step: "A coverage step works for at most `STEP_BUDGET_MS`, its reads of the loaders and records included. Its loader map holds until results, records, a revision or a wake change it. A step that took `d` ms on the main thread starts its successor no sooner than `d` ms later (row 015-42)."
- D10: "Coverage work takes at most half of the daemon's main thread while it runs (row 015-42)."

## Type changes (all additive)

- `CoverageStepInput.cache?: StepCache` (new class, `crap/index.ts` exports it).
- `CoverageWriterOptions.worker?: MapWorker | null` (`MapWorker` new in `coverage/mapper.ts`).
- `scriptPath` is exported from `coverage/record.ts`.
- New modules: `coverage/pace.ts` (`Pace`), `coverage/mapper.ts` (`Mapper`, `MapperOptions`, `MapWorker`, `ToWorker`, `FromWorker`, `mapWorkerScript`, `mapHere`, `threadMapper`, `workerMapper`), `coverage/map-worker.ts` (worker entry), `crap/cache.ts` (`StepCache`, `signatureOf`).
- `STEP_BUDGET_MS` keeps its value (50). Its budget now counts from the step's start.

## Residue for the next worker

- **Bundles not built** (the brief). The committed-dist checks fail until the coordinator builds: the four "exactly as `npm run build:plugin`" tests and the new "ship the coverage records' mapping worker" test. Until then the plugin daemons find no `cli/coverage-map.mjs` and map on the main thread, paced.
- **The cold loader read is one turn.** In the first step after the code pass opens its store, `settled` is empty and `readLoaders` queries `results.byKey` for every key: 1.3 s in the real-store profile at load 47, inside a first step of 1.9 to 7.2 s. Warm reads after an invalidation take about 100 to 200 ms. Reading the loaders in slices across steps would bound it.
- **Fixed costs per step outside the judging:** `files.list`, `readSummary`, the summary write, and `writeJudgement`'s list of every complexity edit. About 30 to 40 ms, so the median real-store step is 87 to 109 ms against the 50 ms budget. Pace keeps the share at 50%.
- **During a run, each result batch drops the whole loader map.** Refreshing only the conditions of the keys that got a result would avoid a warm read per batch.
- **The first job of each run sends its sources to the worker** by structured clone: about 22 MB for 300 sources here, a turn of 54 to 58 ms at load 28 to 40. Sending them in chunks would bound it if closures grow.
- **Files over about 300 lines:** `pass/index.ts` 330 (303 before), `crap/step.ts` 306 (285 before).
- **`CodePass.idle()` does not wait for a paced step**, as it did not wait for the `setImmediate` continuation before.
- **Re-enabling coverage here** (`squeal.config.json`) and the 015-14 window are the coordinator's, after the bundles are built.
