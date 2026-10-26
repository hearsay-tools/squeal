# 015-55 and 015-56 notes: an edit pass in parts; the long recount turn named

Worker afa0f736, 2026-10-26. Brief: `tasks/wave-10.md` W2. Starts from main at 0.1.328 (`7c50fecbd`). Shape: slice. Code changes are inside the brief's ownership (`src/core/code/pass/**`, `test/code/pass/**`, `test/code/crap/chain-load.test.ts`). The store changes are in `src/core/code/store/**` by the coordinator's agreement (reply to request `a76cf7e2`), in one commit of their own. No table, column, index, `user_version` or result key changed. Bundles are not built (the brief), so the four committed-bundle tests in `test/harness/**` fail until the coordinator builds.

## What changed

- **The store adopts staged edit marks and transitions** (`7084b835e`, store, its own commit). `CodeStateRepo.adopt` now copies `edited_revision` and `edited_at` with each staged state. On a conflict it keeps the worktree's mark when the staged row has none (`coalesce`), so it can never clear a mark. `CodeTransitionRepo.adopt(worktreeId, staged, expected)` counts the staged transitions. When the count is `expected`, it copies them in `id` order with new ids (`INSERT ... SELECT`), and returns the number copied. Otherwise it copies nothing and returns 0. `CodeTransitionRepo.dropStaged(staged)` deletes a staging id's transitions and throws for any id that is not a staging id. `stagedId` and `isStagedId` moved to `store/staged.ts`. The transition repo moved from `states.ts` to `transitions.ts` (`states.ts` was over 300 lines). Test: `test/code/adopt.test.ts`.
- **An edit pass over more than one part stages, then switches in one transaction** (`f8bf636fa`, `pass/stage-edit.ts`, `pass/edit.ts`, `pass/bodies.ts`, `pass/counted.ts`, `pass/judge.ts`, `pass/pass.ts`, `pass/stage.ts`). An edit pass of more than `PART_FILES` (32) changed files now runs these steps, each part within `PART_BUDGET_MS` (25 ms) and a turn apart:
  1. Clear what an earlier pass left staged: states and transitions.
  2. Read each part: its complexity states, the body hashes of their counts, its counts, and its sides (added, gone, before).
  3. One turn later, over all files: match the moves by body (`matchMoves`, D2 pairs checks of any two files), the prior state of each moved check, the removals (held while a file waits for its listing, row 015-52), and the D9 failures of removed checks.
  4. Stage the failures' transitions; judge each part and stage its states, edit marks and transitions; stage the removals' transitions. This is the order the one-transaction pass appends them in.
  5. One turn later, one transaction: the symlinks' file rows, the moves, `states.adopt`, `transitions.adopt`, the pulled record (015-38) and the meta. When either adopt writes fewer rows than were staged, a prune took staged rows, and the same transaction writes the whole set the old way.
  6. One turn later, drop the staged rows.

  An edit of 32 files or fewer keeps its one transaction (`editEnd`, the old tail moved to `edit.ts`). The first turn no longer reads `oldBodies` for every file of a staged pass: each part reads its own. `runPass` stays at CC 18 because the plan moved into `edit.ts` (`judgedFiles`, `EditPlan`) and two helpers (`committedOf`, `readOld`).
- **The quiet pass's switch takes a turn of its own** (`f8bf636fa`, `pass/stage.ts`). Row 015-56. Before, the switch transaction ran in the same turn as the last part. `inParts` also gives the first part a new turn.
- **Each long turn's phase is recorded** (`a9349296a`, `3cdda4833`, `test/code/pass/turns.ts`, `chain-load.test.ts`, `pull-load.test.ts`). `TurnLog` records each turn over 50 ms with these values: its wall time, the main thread's CPU time (`process.threadCpuUsage`), the phase the test marked (counting, a coverage step, between coverage steps, after the pass), the GC pauses in it, and its write transactions with their first statement and commit time. `chain-load` logs the three longest turns of each case. On CI the timing tests now bound the main thread's work in its longest turn, see 015-56 below.

## Measurements

All on this host (24 CPUs). Each line gives the one-minute load from `uptime` at the start of the run and the load the test read. The host was never under load 8 while I measured: the 016 eval was paused, but other coordinators' work ran. So every 100 ms assertion skipped, and the numbers below are the logged values. I made no load of my own beyond the measured process. "Thread" is the main thread's CPU time in the turn. A turn includes up to one 5 ms tick of slack.

### 015-55: a pull and an edit of every file (`test/code/pass/pull-load.test.ts`)

The store: 1,263 files of 10 functions, first counted and committed. The change: half the functions of every file go to CC 25 with new bodies. "Pull" is a commit (a HEAD move): 6,315 transitions, no edit marks. "Edit" is a working-tree edit: 6,315 transitions and 6,315 edit marks.

| Code | Run | Pull, longest turn | Edit, longest turn | Load (uptime 1 min) |
| --- | --- | --- | --- | --- |
| main `7c50fecbd` | 1 | 222 ms (thread 214), the last transaction 220 ms (commit 16); first turn 124 ms | 298 ms (thread 285), the last transaction 250 ms (commit 21); first turn 97 ms | 12.95 |
| main `7c50fecbd` | 2 | 315 ms (thread 292), the last transaction 309 ms (commit 21); first turn 133 ms | 302 ms (thread 295), the last transaction 242 ms (commit 15); first turn 109 ms | 12.47 |
| main, earlier | 2 runs | 267 ms, 337 ms | 319 ms, 472 ms | 20.9 to 22.2 |
| this branch | 1 | 50 ms (thread 44) | 52 ms (thread 47) | 14.38 |
| this branch | 2 | 51 ms (thread 46) | 50 ms (thread 43) | 13.87 |
| this branch | 3 | 63 ms (thread 54) | 56 ms (thread 48) | 13.56 |
| this branch | 4 | no turn over 50 ms | no turn over 50 ms | 13.44 |
| this branch | 5 | 77 ms (thread 69, gc 12) | 51 ms (thread 45) | 12.59 |
| this branch, `CI=1` | 1 | 55 ms (thread 50) | 61 ms (thread 53) | 16.8 to 17.4 (the test's reading) |

On main, both long turns are the pass's own: the first turn (plan, `oldBodies` of every file, the files rows) and the last transaction. On this branch the longest turn is the switch transaction (50 to 65 ms, commit 13 to 19 ms).

### 015-56: the recount (`chain-load.test.ts`, "recounts 1263 sources")

| Code | Runs | Longest turn | Load (uptime 1 min) |
| --- | --- | --- | --- |
| main's pass, phases logged (`a9349296a`) | 12 runs of the case | 89 to 121 ms (thread 84 to 109) | 17.47 to 22.55 |
| same | 5 runs of the whole file | 83 to 104 ms (thread 76 to 95) | 17.71 to 21.89 |
| this branch | 8 runs of the case | 82 to 98 ms, except one 140 ms | 14.91 to 17.98 |
| this branch, `CI=1` | 1 | 81 ms (thread 73) | 18.1 (the test's reading) |

On main, in all 17 runs, the longest turn was the quiet pass's switch transaction (first statement `DELETE FROM files ...`, 70 to 100 ms, commit 19 to 33 ms) in the same turn as the last part. On this branch the switch has its own turn (71 to 84 ms of transaction, commit 20 to 23 ms). The longest turns are now the switch or a coverage step (78 to 92 ms). The difference between the two series is small, and the loads differ: it shows the switch in its own turn, not a large gain.

The one 140 ms turn (run 5, uptime 16.72): a coverage step, with 60 ms of thread CPU and a 6 ms GC pause. Its transaction (first statement `INSERT INTO checks ...`) took 130 ms, of which the commit took 79 ms. The same step's commits in the other runs took 1 to 14 ms.

`strace -f -T -e fsync` over one recount (main's pass) shows pairs of `fsync` calls on the WAL and the database file during the pass: 1 to 10 ms each on this host's disk. A commit that takes the WAL over 1,000 pages runs the auto-checkpoint inside that commit, on the main thread: SQLite writes the WAL's pages back and syncs both files before the commit returns.

### CI history of the recount case (main pushes, shard 2, Node 22.19)

23 runs from `40219557279` to `40246921578` (load 2.9 to 4.9): longest turn 94 to 185 ms, median 128 ms. The coverage start case in the same runs: 69 to 96 ms. Once 443 ms: `40225321737` attempt 1, load 3.7. In that run the start case's longest turn was also long, 128 ms against the usual 69 to 96. The recount's total time, 3,513 ms, was in the usual range (1,809 to 3,962). One older run, `40224569463` (510 ms), ran the test before 015-48's staged pass.

## 015-56: the cause and the bound

**Cause.** The longest recount turn has two parts. The first is the pass's own CPU work, 60 to 110 ms of thread time on this host. It is the quiet switch on main, and the switch or a coverage step now. The second is waits that are not the code's work. These are a commit that runs a WAL checkpoint and waits for its disk syncs (the 140 ms turn: 60 ms of work, 79 ms of commit), and the time the thread waits for a CPU on a busy machine. On CI the usual turn is already 94 to 185 ms, about twice this host's 66 ms at load 1.7 (`tasks/015-48/notes.md`). In the run with the 443 ms turn, the start case's turn was also longer than usual. Its log had no phase, thread time or commit times, so its cause cannot be proven now. The most likely cause is a checkpoint's sync on the runner's disk or a CPU wait. The recount's input is the same in every run, so its work is too, and no run here showed more than 110 ms of it in one turn.

**Code fix.** The quiet switch takes a turn of its own. It no longer adds to the last part's turn. The edit pass has the same order: parts, a turn, the global step, parts, a turn, the switch.

**Bound.** On CI, `chain-load.test.ts` and `pull-load.test.ts` now assert the main thread's CPU time in its longest turn under 250 ms (`TurnLog.longestWork`). That time holds the code's work, not the runner's waits. Off CI the wall-time bound stays: under 100 ms at load 8 or less, skipped above. The log gives both values, and for each long turn its phase, GC pauses and transactions. A later long CI turn then shows whether the turn's work or a commit wait made it. No other test changed its bound.

**Residue.** The checkpoint wait stays on the main thread. Moving checkpoints to a separate connection on a worker thread (`wal_autocheckpoint = 0` on the main connection) would take it off. This is store and daemon scope, outside this row.

## Tests

- `test/code/adopt.test.ts`: a staged edit mark is adopted, also on a new state; a state keeps its own mark when none is staged; transitions are copied in order with new ids, after one appended meanwhile; nothing is copied when the count differs; `dropStaged` refuses `"w1"`; `isStagedId`. The edit-mark test is red on the old adopt query.
- `test/code/pass/staged-edit.test.ts`: one scenario run twice, with parts of 2 files and as one transaction. It has a rename in a file, a move to another file with a CRAP state and a view, edits that cross the threshold up and down, a removed failing function, a deleted file, a new file with a first-seen failure, a body-hash move across parts, a file that becomes too big, a file changed by a commit (no edit mark), a file now listed as a test file, and a symlink. Each run checks the rows of every table (without ids), the report's moves, transitions and edits, and the order of transitions. A second case holds the removals while a new file waits for its listing. Further cases: a hook that reads on every turn sees the old pass or the new one, never a mix; rows an earlier pass left staged are never adopted; a prune between two parts makes the switch write the whole set. Four of the five were checked red on main's pass code (`7c50fecbd`). The listing case came later and uses the same check that adopt runs once.
- `test/code/pass/pull-load.test.ts`: the two timed cases above. They skip above load 8, with 100 ms off CI and 250 ms of thread work on CI. On main's pass they log 222 to 472 ms.
- `test/code/crap/chain-load.test.ts`: its four cases log each long turn's phase. On CI they assert the thread work, as above.

## Decisions the spec did not settle

1. **When an edit pass stages.** With more than `PART_FILES` (32) changed files. An edit of up to 32 files keeps its one transaction, as the coordinator asked.
2. **The staging id.** An edit pass uses the same `stagedId(worktreeId)` as a recount (`"<worktreeId> recount"`). Passes in one daemon never overlap, so one id per worktree is enough (comment in `store/staged.ts`). The suffix keeps its name, so prune and older daemons see the same id.
3. **The global step is not split.** Move matching, the prior states and the removals run in one turn over all files, because a move pairs checks of any two files (D2). It keeps only the gone checks' bodies past their parts. In the pull-load cases no check goes, so this step is small and no long turn fell in it. I did not time an edit pass that renames every function of a large store; there the step grows with the number of gone checks (see the last section).
4. **Order of gone checks across parts.** The parts follow the plan's order of paths (JavaScript string order). The one-transaction pass reads them in SQLite's `BINARY` (UTF-8) order. The two orders differ only between paths with characters above U+FFFF and paths with characters from U+E000 to U+FFFF. Only then can a body-hash move with two equal candidates pick a different `from`.
5. **No edit-pass path clears a mark.** `markEdited` writes a revision and a time, never `NULL`. `upsertMany` does not touch the mark columns. `adopt` uses `coalesce`. A mark goes only with its state's row (a removal). So no write had to stay in the switch for that reason.
6. **One CI bound for all chain-load cases.** All four cases use the thread-work bound on CI, not only the recount, because the same waits can lengthen any of them.

## Type changes

All additive.
- `CodeTransitionRepo.adopt(worktreeId, staged, expected): number` and `CodeTransitionRepo.dropStaged(staged): void`.
- `CodeStateRepo.adopt` keeps its signature; it now carries the edit marks.
- `stagedId` and `isStagedId` are exported from `src/core/code/store/index.ts`. `pass/stage.ts` re-exports `stagedId`.
- `PassContext.partFiles?: number` (tests set small parts).
- `pass/judge.ts` exports its steps: `Sides`, `quietOf`, `sidesOf`, `movable`, `priorOf`, `judgeCounted`, `judgeGone`, `matchMoves`, and re-exports `Counted`.
- New files: `store/staged.ts`, `store/transitions.ts`, `pass/bodies.ts`, `pass/counted.ts`, `pass/edit.ts`, `pass/stage-edit.ts`, `test/code/pass/turns.ts`.

## For the next worker

- Spec D4 (**The pass**, **A quiet pass in parts**) still describes an edit pass as one transaction. The coordinator amends it.
- The checkpoint wait (015-56 residue) is the next cut for long turns on a slow disk.
- An edit pass that renames every function of a large store can make the global step one longer turn; it is not measured. If a measurement shows it, split `matchMoves` by body hash.
- `pass/index.ts` is 348 lines; this row did not change it.
