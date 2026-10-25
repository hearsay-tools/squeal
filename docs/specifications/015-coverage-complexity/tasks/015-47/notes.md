# 015-47 notes: a recount's seed of coverage states is sliced

Worker 34afe933, 2026-10-25. Brief: `tasks/wave-6.md` W1. Starts from main at 0.1.309 (`ca76cc5aa`). Shape: repair. All changed code is inside the brief's ownership (`src/core/code/crap/**`, `src/core/code/pass/index.ts` and their tests). Records, `COVERAGE_PROVIDER_VERSION` and result keys are unchanged.

## What changed

- **The CI bound** (`7213aa2f9`). `chain-load.test.ts` asserts 100 ms off CI and 250 ms when `process.env.CI` is set. Its log line is unchanged.
- **The seed goes on over steps** (`b0b5c6685`, `crap/seed.ts`, `crap/step.ts`, `crap/cache.ts`, `pass/index.ts`). `Seed` replaces the `seed` function. A step seeds before it reads the loader map. A step that has not finished the seed judges nothing and reports `seeding`. The pass keeps a recount's `reseed` until a step judges, as it does for `reading`, so B2's quiet set still covers every file. The `StepCache` keeps the seed across steps: `invalidate` and `settle` leave it, because it reads no loader or record. The step drops it after the step that judges. The pass drops it at a recount, when coverage goes off, and when the store closes, so the next seed begins again.
- **The seed holds the files as they were when it began.** If an edit changed a file after that, the seed gives a pending state only to the functions that the file's count had then. So a function the edit added is still a first-seen fail (D9). A file that is gone or too big seeds nothing. If the old count was pruned, the seed uses the current count: the result is quiet, not a false fail.
- **A unit of the seed is 32 files** (`3af9503c1`, `SEED_FILES`). The unit is one read of their `crap` states by path, their current rows, their counts and one upsert. The first-count check (`files.uncounted`) and the full file list run once, when a seed begins. Before, they ran at every step while coverage started. A step that reads the loader map reads no file list.
- **The walk writes its judgements 16 files at a time, inside its budget** (`e650adab4`, `crap/walk.ts`, `WRITE_FILES`). After a recount, every ready file is judged again. The walk wrote all of a step's judgements after its budget: steps of 136 to 259 ms on 1,263 sources. The walk now runs inside the step's transaction, and the budget counts its writes. `broughtByGit` now gives every file that git changed. `keepUnjudged` keeps only the files of the summary, as `broughtByGit`'s filter did. The walk and `writeJudgement` moved from `step.ts` to `walk.ts`, unchanged except for the batching.

## Measurements

All runs at `nice -n 10` on this host (24 CPUs). Other coordinators loaded it at 42 to 75. I made no load of my own. The one-minute load is given for each run. The timing assertions skip above load 8, so no asserted run here was quiet.

### 011-197's stores (`/tmp/r197/bench/common`: 1,263 code files, 12,433 `crap` states, 1,072 keyed test files)

A scratch bench (not committed) gives each run a fresh reflink copy of the stores, in a fresh process. It runs `runCoverageStep` in a loop with one `StepCache` until no step has `more`, as the pass does. "Recount" passes `reseed` until a step judges. "Start" clears coverage first (`clearCoverage`), then closes and opens the store again. "Warm" reads the copy once first, so its pages are cached, as in a running daemon. Main and the branch leave the same states: the digest of every non-complexity state matches (recount `5e7010502014`, start `f374debc42c1`).

| Chain | Main at 0.1.309, longest step | This branch: seeding steps, longest | This branch, longest step of any kind | Load |
| --- | --- | --- | --- | --- |
| Recount, warm | 320, 659 ms | 4 to 6 steps, 58 to 96 ms | 100, 111 ms (the walk) | 53.5 to 57.4 |
| Start, warm | 543, 910 ms | 7 steps, 76 to 83 ms | 83, 189 ms (the walk) | 55.1 to 59.3 |
| Recount, cold | 546 to 1,627 ms | 12 to 20 steps, 86 to 306 ms | 113 to 308 ms | 48.6 to 75.0 |
| Start, cold | 1,243 to 2,767 ms | 10 to 18 steps; the first step 593 to 913 ms | 593 to 913 ms (the first step) | 49.5 to 74.1 |

On main, the longest step is the walk's first step: the seed, the judgement and their writes in one turn. On the branch, a cold start's first step is the first-count check. On a copy whose pages are not cached, `files.uncounted` read the counts table in 479 ms. With the pages cached it took 23 to 32 ms, at load 60 (residue below).

The seed's parts, in one process at load 60, on a cold copy: the `crap` states by path, one read for each of 1,263 files, 308 ms; by 32 paths a read, 75 ms; all in one list, 202 ms. The counts of 1,263 files, 63 to 73 ms. The file list, 9 ms. The summary, 2.6 ms.

### Tests

| Test | Before | After | Load |
| --- | --- | --- | --- |
| `seed.test.ts`, start and recount (fake clock, a count read 2 ms, 96 files) | 96 count reads in one step (red, on main) | at most 32 (one unit) a step; states pending until every function is seeded; then judged with no transition | n/a |
| `seed.test.ts`, recount, with the pass clearing `reseed` after a seeding step (a mutation check) | n/a | red: a renamed function judged before every renamed function was seeded | n/a |
| `chain-load.test.ts`, the recount of 1,263 sources of 10 functions, half renamed; the longest coverage step, with the load skip lifted for this check only | main 473 ms; `3af9503c1` 259 ms (red) | 75, 77, 82, 101 ms | 42.4 to 56.1 |
| `chain-load.test.ts`, the two cases of 015-42 and 015-45 | unchanged | unchanged; at load 48 to 54 their longest turns read 75 to 150 ms (skipped, as before) | 48 to 54 |

## Tests

- `test/code/crap/seed.test.ts` (new; fake clock; `createCountRepo` mocked so that a count read takes 2 ms). At coverage's start and at a recount through `daemonPass`, the seed goes on over steps of at most one unit. No state is judged, and the recount's judgement is not made, before every function is seeded. After that, the states are judged with no transition: B2's renamed function and its CC that crosses the threshold stay quiet.
- `test/code/crap/chain-load.test.ts`: a third case, the recount on an incident-size store with no coverage step over the turn budget (skipped when loaded). `TimedPace` measures each step. The event loop's longest turn is in the log line, but this case does not assert it (see residue).
- `test/code/crap/validity.test.ts`: `counterV2` moved to `rig.ts`, unchanged. B1's and B2's tests pass.

## Decisions the brief did not settle

1. **The seed comes before the loader map.** A record that arrives during the seed revokes the map but not the seed. So the seed makes progress while results arrive, and the map is read once, after it.
2. **No file is judged until every file is seeded.** This is stronger than "no file before its own functions". It is simpler, and a seed takes 4 to 7 steps warm on 011-197's stores.
3. **An edit during a seed seeds only what the seed's file list had.** A function that a rename moved (the complexity pass's `move`) in a file not yet seeded is not seeded, so it can read as first-seen. That is rare, and it would need the complexity pass's moves.
4. **The seed's progress is held in memory, not in the store.** A daemon that stops during a seed loses the recount's `reseed`. Before this row, the same was true while the map was read (015-45) or while the pace waited. A daemon that starts again during a start seed begins it again, because no summary was written.
5. **The walk's writes moved into the step's transaction.** A hook that reads during the step still sees either the step before or the whole step, because judgements and summary commit together.
6. **The pass's shared turn stays** (coordinator, reply to request `0039d22f`, option a). See residue.

## Proposed amendment lines (the coordinator folds them in)

- D9, the step: replace "A recount's seed is still one turn, 429 to 489 ms on 011-197's stores (row 015-47)." with: "The seed at coverage's start or a recount goes on over steps, 32 files a unit within that budget, before the step reads the loader map; no file is judged until every file is seeded, and a step judging after a recount writes its judgements within the budget too (amended 2026-10-25, 015-47)."
- D9, the same paragraph: "The seed holds the files as they were when it began: a file an edit changed since seeds only the functions its count had then (015-47)."

## Type changes

- `CoverageStepReport.seeding?: true` (additive).
- `StepCache.seed(begin)` and `StepCache.dropSeed()` (additive).
- `Seed` (class, `crap/seed.ts`) replaces the `seed` function. `SEED_FILES` is exported from `crap/index.ts`.
- `crap/walk.ts`: `walk`, `Walk`, `WRITE_FILES` (moved from `step.ts`; `Walk` gains `brought`).
- `broughtByGit(meta, worktreeId, summary)` has no `next` parameter now. `keepUnjudged` removes the files that are not in `next` (internal to `crap/`).

## Residue for the next worker

- **The recount's complexity write is one turn** (coordinator: a row of its own). In `chain-load.test.ts`'s recount of 1,263 sources of 10 functions, the final transaction of `runPass` (`src/core/code/pass/pass.ts`) took 437 ms at load 42, and 212 ms for the first count. The first coverage step runs in the same turn, because `coverageStep` follows `await runPass` in `once()`. So the event loop's longest turn at that recount is 482 to 629 ms at load 42 to 53, and the coverage step is at most about 80 ms of it.
- **The first-count check at coverage's start is one unit.** `files.uncounted` reads the counts table: 23 to 32 ms with its pages cached at load 60, and 479 ms cold (a fresh copy). A start whose counts are not cached makes one long first step. The seed's batches read every count anyway, so they could do this check, 32 files at a time.
- **The walk's longest steps on 011-197's stores** were 100 to 189 ms warm at load 53 to 59. Most of each is over budget and is not the seed. On this host at that load, preemption alone adds tens of ms, so a quiet host should measure this again.
- **Files over about 300 lines:** `pass/index.ts` 339 (335 before). `crap/step.ts` is 207 (283 before): the walk moved to `crap/walk.ts` (146).
- **Bundles not built** (the brief). The committed-dist tests may fail until the coordinator builds.
