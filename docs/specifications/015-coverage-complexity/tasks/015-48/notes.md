# 015-48 notes: a recount's complexity write is sliced

Worker 557fa03e, 2026-10-25. Brief: `tasks/wave-9.md` W1. Starts from main at 0.1.317 (`7d397293c`). Shape: slice. Code changes are inside the brief's ownership (`src/core/code/pass/**`, `src/core/code/crap/**` and their tests), plus `src/core/code/store/states.ts` and `types.ts` for `CodeStateRepo.adopt` only, by the coordinator's agreement (reply to request `65789ce6`, option a). No table, index, column, `user_version`, record or result key changed. Bundles are not built (the brief), so the committed-dist tests fail until the coordinator builds.

## What changed

- **`CodeStateRepo.adopt`** (`821f91f72`, store, its own commit). `adopt(worktreeId, staged, measure, removed)` writes each `measure` state staged under the id `staged` over the worktree's, keeping each state's last edit as `upsertMany` does. It removes every measure's state of each `removed` check, and returns the number of states written. Two set-based statements in one transaction. The staged rows stay; the caller drops them. Test: `test/code/adopt.test.ts`.
- **A first count or a recount stages its states** (`e8f66a4f6`, `pass/stage.ts`, `pass/end.ts`, `pass/pass.ts`). After the counts are stored, `stageQuiet` reads, judges and stages the files 32 at a time (`PART_FILES`). It reads each part's counts and complexity states by path, judges them (a quiet pass judges each file alone: no move, transition or edit joins two files), and upserts their states under `stagedId(worktreeId)`, `"<worktreeId> recount"`, in one transaction per part. A part works up to `PART_BUDGET_MS` (25 ms) by the pass's clock, then the pass gives the event loop a turn. Before the first part it deletes every staged row an earlier pass left (complexity is the one measure it stages). The last transaction holds the symlinks' file rows, `adopt`, the pulled record, the cursor, the listing's record, the failed counts and the recount record. When `adopt` writes fewer states than were staged, a prune took staged rows between parts, and the same transaction writes the whole set with `upsertMany`. A turn later the pass drops the staged rows with `removeMeasure(staged, "complexity")`. An edit pass keeps its one transaction. `quietEnd` (in `stage.ts`) and `writeEnd`/`report` (in `end.ts`) left `pass.ts`, so it is 257 lines.
- **The coverage step takes a turn of its own** (`e8f66a4f6`, `pass/index.ts`). `once()` waits a turn after a pass that did something, before `coverageStep`.
- **Stored counts are looked up a slice at a time** (`97bca714e`, `pass/blobs.ts`). `countMissing` read and parsed every stored count in one turn to learn which blobs lack one. It now looks them up `SLICE_FILES` (200) at a time, a turn apart, as it counts. This mattered for a threshold or include recount, whose counts are all stored.
- **The seed reads within the step's budget** (`dd893de3e`, `crap/seed.ts`, `crap/step.ts`, `crap/cache.ts`). `Seed.follow(report)` only queues the moves and removals, in order. `advance` reads them first, one `work()` unit each, and seeds no file until all are read (review 0.1.311-r2 N1). At coverage's start the seed no longer waits for `files.uncounted` over every file: `beginSeed` begins it at once, and each 32-file unit checks its files' current rows and counts. A file with no count, not too big, whose count the counter did not give up on (`spentFailure`) holds the seed at that unit, and the step returns `null`, as it did while the first count ran. The seed keeps its place, so the next step goes on from that unit.

## Measurements

All on this host (24 CPUs), one-minute load given per run. I made no load of my own beyond the measured process. "Gap" is the longest stretch between two `setImmediate` ticks in a disposable probe (not committed); `chain-load.test.ts` reports `monitorEventLoopDelay`'s maximum. The store is `chain-load`'s recount store: 1,263 sources of 10 functions, 37,890 states (12,630 complexity), judged by coverage first.

### Before (main at `7d397293c`, with this row's seed commit only where marked)

| Run | Turn | Load |
| --- | --- | --- |
| Recount, half the functions renamed: the last transaction (read 46, judge 45, removals 33, upsert 81, commit 16) | 222 ms | 25 |
| Same recount, the whole turn: count reads 56 + transaction 181 + first coverage step about 65 | 302 ms | 18.3 |
| Recount, names kept | 226 ms | 18.9 |
| `chain-load` recount case, pre-staging pass (`dd893de3e`) | 265 ms | 1.6 |
| `chain-load` start case, pre-row code (`7d397293c`), pages warm | 66 ms | 1.8 |
| Threshold recount, first turn (store open, plan, files rows, every count looked up, first part) | 76 ms | 3.4 |

Write paths for 12,630 states on that store, at load 17 to 18: per-row `upsertMany` 109 to 132 ms, a set-based `json_each` upsert 96 to 121 ms, staged parts of 1,000 states 5.3 ms each, the staged switch 54 ms (drop included).

### After (`97bca714e`)

| Run | Longest turn | Load |
| --- | --- | --- |
| `chain-load`: recount of 1,263 sources, half renamed | 66 ms | 1.7 |
| `chain-load`: coverage's start on 1,263 counted sources | 68 ms | 1.6 |
| `chain-load`: 200 sources by 300 test files | 71 ms | 1.6 |
| `chain-load`: loader map of 1,072 test files | 65 ms | 1.7 |
| Probe: recount, half renamed (switch turn 56 ms: `adopt` 44 ms for 12,630 states and 6,315 removed checks) | 66 to 73 ms | 2.0 to 3.3 |
| Probe: recount, names kept (switch turn 19 ms) | 60 to 63 ms | 1.9 to 3.9 |
| Probe: threshold recount (first turn 16 to 18 ms) | 59 to 68 ms | 3.2 to 3.4 |
| Probe: coverage's start | 64 ms | 1.5 |

In every run after, the parts take 26 to 33 ms and the drop of the staged rows 4 to 6 ms; the longest turns are the coverage steps (50 ms budget and one unit, 52 to 61 ms) and the switch with many removals. At load 8 and above the timing assertions skip, as before.

## Tests

- `test/code/adopt.test.ts`: adopt writes over the worktree's states keeping edits and other measures, removes every measure of a removed check, counts what it wrote, and writes nothing when nothing is staged.
- `test/code/pass/staged.test.ts`: a hook reading on every turn of a recount sees the old states or the new ones, never a mix, and sees every new count stored while the states are still the old ones; leftover staged rows from an earlier pass are never adopted; a prune between two parts makes the switch write the whole set. All three fail on the pre-staging pass.
- `test/code/pass/slices.test.ts`: a threshold recount with three lookup slices gives two turns more than with one. Fails on the old `blobs.ts` (2 against 4).
- `test/code/crap/seed-budget.test.ts`: `follow` reads no count, `advance` reads the moves within its units and seeds nothing before; a start's seed waits at an uncounted file a unit at a time and goes on once it is counted; a file the counter gave up on does not hold it.
- `test/code/crap/chain-load.test.ts`: the recount case now asserts the longest turn of the whole recount, not only its coverage steps (`TimedPace` is gone), and a new case times coverage's start on the same store. Both skip above load 8, with 250 ms on CI. The recount case fails on the pre-staging pass (265 ms at load 1.6). The start case passes on the pre-row code with warm pages (66 ms): it guards the bound, and does not reproduce the cold 479 ms read.
- The recount, first-count, seed and listing tests pass unchanged.

## Decisions the spec did not settle

1. **Where staged rows live.** In `states`, under `"<worktreeId> recount"`. Worktree ids are 16 hex characters, so the staged id never equals one. Prune treats it as a worktree that is not live: it clears what a crash leaves, and it counts the id in `worktreesRemoved` when it finds rows (accepted by the coordinator).
2. **The fallback.** The count check covers a prune by another worktree's daemon, which deletes 256 rows per transaction and can interleave with the parts. The fallback costs one long turn in that rare case, never a mix.
3. **Budget.** `PART_BUDGET_MS` is 25 ms, half the coverage step's 50, because a part's last batch and the turn's other work add to it. It is measured by the pass's clock (`ctx.now`), as the coverage step's budget is; tests with a fixed clock run every part in one turn.
4. **The start's wait.** The seed seeds the units before an uncounted file, then waits there. Before, nothing was seeded until every file was counted. Either way no function is judged before every function is seeded, and the functions seeded early are pending, as they would be.

## Type changes

- `CodeStateRepo.adopt` (additive).
- `Seed`: the constructor takes a third argument `counted` (default `false`); `advance` returns `"done" | "more" | "uncounted"` instead of a boolean; `follow(report)` no longer takes the store. `StepCache.follow(report)` likewise, and `StepCache.seed` takes a begin that never gives `null`. All internal to `src/core/code/crap`.
- New in `src/core/code/pass`: `stage.ts` (`PART_BUDGET_MS`, `PART_FILES`, `stagedId`, `stageQuiet`, `adoptStaged`, `dropStaged`, `quietEnd`) and `end.ts` (`End`, `writeEnd`, `report`). `PassReport` is unchanged.

## Residue for the next worker

- **An edit pass keeps its one transaction** (the coordinator's rule 6). A pull or checkout of every file of the store above, half its functions newly over: a first turn of 110 ms (the plan, `oldBodies`' read of every state and count, the files rows) and a last turn of 309 ms (count reads, judge, writes), at load 7.3. Staging an edit pass needs its moves, transitions and edits across files, so it is not the quiet path's parts.
- **The switch grows with removals.** 19 ms with none, 56 ms with 6,315 removed checks (18,945 rows of three measures) at load 2. A recount that removes most functions of a larger store could pass 100 ms.
- **`pass/index.ts` is 348 lines** (345 before; 3 lines for the turn before the coverage step).
- **The cold first-count read** is gone from coverage's start, but no committed test reproduces a cold page cache.
- **Bundles not built** (the brief). The committed-dist tests (`test/harness/plugin.test.ts`, the Codex, OpenCode and Pi package tests) fail until the coordinator builds.
- Spec D4 (**The pass**) and D9 (**First judgement**, the start's first-count check) need the coordinator's amendment.
