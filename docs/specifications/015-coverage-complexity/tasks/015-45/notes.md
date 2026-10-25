# 015-45 notes: coverage's share of the main thread holds for the writer and the judge together; the cold loader read is sliced

Worker 40cd05f1, 2026-10-25. Brief: `tasks/wave-5.md` W1, from review 0.1.305 S1 and S2. Starts from main at 0.1.305 (`641191664`). The three-line wiring in `src/core/daemon/daemon.ts` was agreed with the coordinator (reply to request `c0917dfc`, option a) and is its own commit.

## What changed

- **The loader map in slices** (`crap/loaders.ts` `LoaderBuild`, `crap/cache.ts`, `crap/step.ts`). The listing of the worktree's test file keys is one unit of work. Each test file read into the map, its result lookups (`results.byKey`, `coverage.has`) and its closure walk, is one more. The step reads the map first and counts it in `STEP_BUDGET_MS`. The `StepCache` keeps a build in progress across steps and gives out the map only once every listed test file is read. A step that read only part of it judges and seeds nothing, and reports `reading`, so a recount's reseed waits for the step that judges. `invalidate` drops a build in progress; the next step starts it again. The pass's `settled` conditions outlive that, so a test file already read as ready costs a map lookup the second time.
- **A file's condition and signature are a unit too** (`crap/step.ts` `walk`). Before, the first step after the map computed the condition and signature of every counted file outside the budget: 27 ms over budget in `chain-load.test.ts`. A file past the budget keeps its last summary and sets `more`.
- **The judged files' states by path** (`store/states.ts`, `crap/step.ts` `writeJudgement`). `states.list` with `paths`, and `states.edits`, which gains an optional `paths`, read each path's checks first and their states by key, in that order (`CROSS JOIN`). They scanned every state of the worktree: on 011-197's store (37,299 states) the first judging step after a start read its 6 files' prior states in 65 ms and the complexity edits in 48 ms, a step of 110 to 132 ms. By path: 0.7 to 2.5 ms. Same rows, same order; `code-deliver.ts`'s and the complexity pass's reads by path get the same plan.
- **One pace** (`coverage/pace.ts`, `coverage/writer.ts`, `pass/index.ts`, `daemon/daemon.ts`). `CoverageWriterOptions.pace` and `CodePassOptions.coverage.pace` take one `Pace`; absent, each makes its own, as before. The daemon makes one and gives it to both. The writer checks `due()` after each wait and waits again while the coverage step ran meanwhile, so a writer job and a step never start in the same window. Reactive units (the worker path's message handlers) still add to the window they run in, so the share holds for them too.

Records, `COVERAGE_PROVIDER_VERSION` and result keys are unchanged. `STEP_BUDGET_MS` keeps its value (50).

## Measurements

All runs at `nice -n 10` on this host (24 CPUs), loaded by other coordinators; the one-minute load is given. Timing assertions skip above load 8, so most runs printed their numbers without asserting.

### 011-197's stores (`/tmp/r197/bench/common`, copied to scratch; 1,072 keyed test files, 310,012 closure paths of 4,744 files, 1,263 code files, 4,932 records of 25 KiB mean)

A scratch bench (not committed) ran `runCoverageStep` in a loop with one `StepCache`, on a fresh copy of the stores for each run, in a fresh process.

| Chain | Before (main at 0.1.305) | After | Load |
| --- | --- | --- | --- |
| After a revision (no recount) | 1 step of 508 ms: the cold map | 10 steps, longest 53 ms, median 51 ms | 9.6 / 9.7 |
| After a recount | first step 940 ms (map 545 ms, seed 429 ms), then 1 more | 11 steps, longest 489 ms (the seed), all others 51 to 54 ms | 9.3 / 9.3 |
| After a revision, with 015-44 (its index, and one judgement again of the 42 files with loaders) and the by-path reads | — | 6 steps, longest 64 to 65 ms, median 51 to 53 ms | — / 0.9 to 1.0 |
| After a recount, the same | — | 5 steps, longest 453 ms (the seed), the others 51 ms | — / 0.9 |

Parts of the cold map before, in one process at load 26: the listing 13.5 ms, `results.byKey` for every key 309 ms, `coverage.has` for every key 715 ms the first time, the closure walk 83 ms. Warm, a full map with `settled` takes 19 to 34 ms, so a map started again after `invalidate` usually fits in one step.

### Tests

| Test | Before | After | Load |
| --- | --- | --- | --- |
| `chain-load.test.ts`, 200 sources × 300 test files | longest turn 104 ms (red); 92 and 99 ms | 68, 76, 78, 85 ms; 67, 68 and 70 ms, asserted | 4.0 / 4.0 to 6.3; 1.0 / 0.9 to 1.2 |
| `chain-load.test.ts`, the incident-size map: 1,072 test files of 290 closure paths, records of 25 KiB | longest turn 207 ms (78 ms with small records, which do not show the cost); 118 and 124 ms (red, asserted) | 65 ms (68 ms with small records); 61, 61 and 63 ms, asserted | 12.7 / 13.3; 1.0 / 1.2 |
| `pace-shared.test.ts` (fake clock) | a step 40 ms after a 60 ms writer job (red) | each unit at least its predecessor's time after it; share under 0.55 | — |
| `sliced.test.ts` (fake clock) | 9 rows read in one step (red) | at most 3 rows a step at 20 ms each; no judgement before the last row | — |

The red runs on the baseline used a detached worktree of `641191664` in scratch with the new test files copied in.

What else is in a 100 ms turn of `chain-load.test.ts`: the step itself is 51 to 69 ms (50 ms budget, one unit past it, then 5 to 20 ms of writes); V8 scavenges reached 21 ms and mark-compacts 6 ms (`--trace-gc`, threads pool, load 4.9).

## Tests

- `test/code/crap/sliced.test.ts` (fake clock, through `createCodePass`): the map is read over several steps, at most the budget's rows each, every row once; no state moves from `pending` until the map is whole. A loader whose result comes during the read is in the map the step judges from.
- `test/code/coverage/pace-shared.test.ts` (fake clock, the writer and the code pass with one `Pace`): every unit of work, a writer job or a step, starts at least the time of the unit before after it ended, and their sum stays under 0.55 of the span.
- `test/code/crap/chain-load.test.ts`: the 015-42 test, unchanged in what it asserts, and the incident-size map with no turn over 100 ms (skipped when loaded).
- `test/code/repos.test.ts`: `states.list` and `states.edits` by path give the rows the full reads give for those paths, each once and in order, with the measure and outcome filters.

## Decisions the brief did not settle

1. **A build is dropped by `invalidate`, not repaired.** Results, records, a revision or a wake start it again. The pass's `settled` conditions hold across, so the second read of a ready test file is a map lookup. Repairing the map in place for the keys that got a result is the residue item 015-42 named; it is not needed for the 100 ms turn.
2. **The map's inputs are those of its start**: `now` and `writing` are read once per build. A wait that ends during a build sets `wakeAt` in the past, and the pass's timer then fires at once and reads the map again.
3. **Without a `StepCache` the map is read whole** (`rig.step`, benches), since no later step would go on with a fresh cache's build.
4. **A unit per file examined** makes a chain take one more step at its end when the budget ran out on files that needed no judgement.
5. **The writer's drain is slower beside a chain.** With one pace, a writer job waits out the step before it, and both together have half of the main thread. On 0.1.305 each had its own half. So the records of a large run take longer to store while a chain runs; the change feed keeps its half, which is what D10 asks. The drain time beside a chain was not measured.

## Proposed amendment lines (the coordinator folds them in)

- D9, the step: "Its loader map is read a test file at a time within that budget, its result lookups and closure walk included, and is used only once whole (row 015-45)."
- D10: "The records' writer and the coverage step share one pace, so their sum stays at about half of the main thread (row 015-45)." This replaces "One shared budget ... is row 015-45 (review 0.1.305 S2)."

## Type changes (all additive, one removal)

- `LoaderBuild` (class, `crap/loaders.ts`, exported from `crap/index.ts`) replaces `readLoaders`, which had no caller left but the step.
- `StepCache.loaders(start, work)` returns `Loaders | null` (was `loaders(read): Loaders`).
- `CoverageStepReport.reading?: true`.
- `CoverageWriterOptions.pace?: Pace`; `CodePassOptions.coverage.pace?: Pace`; `Pace` exported from `coverage/index.ts`.
- `COVERAGE_MEASURES` moved from `crap/step.ts` to `crap/seed.ts`; `crap/index.ts` exports it as before.
- `CodeStateRepo.edits(worktreeId, measure, paths?)`.

## Residue for the next worker

- **The seed at a recount or at coverage's start is one turn**: 429 to 489 ms on 011-197's stores. Its parts there: the list of every `crap` state (12,433 rows) 120 ms, the count of each of 1,263 files 317 ms, the upsert of 24,866 pending states 204 ms. Slicing it needs the seed's progress to outlive a step, and no file judged before its functions are seeded; it touches the start and reseed rules of reviews 0.1.297 B1 and B2. A row of its own.
- **`coverage.has` is slow on a large code store** (0.1 ms a key, warm): the `coverage` table is `WITHOUT ROWID` with 25 KiB rows. Row 015-44 adds a covering index that it reads through.
- **Files over about 300 lines:** `pass/index.ts` 335 (333 before). `crap/step.ts` is 286 (306 before): the seed and `COVERAGE_MEASURES` moved to `crap/seed.ts`, unchanged.
- **Bundles not built** (the brief): the committed-dist tests fail until the coordinator builds (`test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts` and the other "exactly as `npm run build:plugin`" checks).
