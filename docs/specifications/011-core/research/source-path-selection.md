# 011-233: why a source path selected other test files at each revision

Researcher W1 of 011 wave 46, 2026-10-26. Brief: `tasks/wave-46.md` W1. Read: `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, board row 011-233, `tasks/011-219/notes.md` "Squeal's selection", spec 005 D2, spec 011 C7 (the `test_files` table) and C10 (`baseline.onStart`).

Versions: the source read is this worktree at `eec505f3b` (main after 0.1.332). The CLI that ran is the installed Squeal 0.1.332. Worker 1b3ef9fa's tree and its store are gone (no copy was kept), so its own revisions 5 to 7 are not replayed. No live store was opened: the experiments are a fixture store driven through the product's selection and wait code, and read-only `squeal status --json` reads in this worktree, which edited no file any test reads. The one-minute load was 13 to 23 on 24 CPUs. Probes: `probes/source-path-selection/` (its README lists each).

## Questions answered

| # | Question (row 011-233) | Answer | Tag |
|---|---|---|---|
| 1 | Is it the edit cut working as designed, closures not yet resolved at that revision, or a reader lookup that misses imports through a helper? | None of the three is the main cause. The cause is the validity rule on the **one shared closure record per test file**: this worktree uses a record only when it wrote it, or when the last writer's *current* key equals its own. Many worktrees write the same records (this repository has 42 git worktrees on the host; this worktree's status counts results inherited from 21), so the set of readers that pass the rule changes when any of them writes, edits, changes commit or is pruned. The lead (own edit, closures not yet resolved) holds only for the window until the worktree's own runner part stores the readers' closures. The edit cut writes no closure. Imports through a helper are in the closure (5 of 5 in the fixture, 4 of 5 live) | verified by experiment (fixture, live reads), read in source code |
| 2 | Can a named wait on a source path pass while a reader that fails is never selected? | Yes. Fixture: the wait on `src/cli/start.ts` exits 0, "no known failures; 12 test files", while `start-spawned.test.ts` fails at this worktree's key. A queued reader is not waited for either: exit 0 after 1.0 s. Live: `start.ts` selected 3 test files from 04:40 to 04:42 UTC, then 187. At least 70 test files read it statically. `start-spawned.test.ts` was in no sample (0 of 20) | verified by experiment |
| 3 | Is a fix row owed? | Yes. Proposed: answer a source path from the daemon's own reverse index, which holds this worktree's closures, and keep the store rule as the fallback with no daemon | inferred from 1 and 2 |

## Findings

### 1. The cause: one record per test file, checked against the writer's current key

`selectNamedFiles` (`src/cli/named-selection.ts:75`) keeps a stored closure when `record.updatedBy === worktreeId || row.key === keyOf(record.updatedBy, file)` (`validClosures`, line 143). The record is `test_files`, "the newest closure path list, stored once per test file" (011 C7). Every worktree of the repository writes it through `storeClosures` (`src/core/scheduler/revision.ts:272`). Four callers write it: the bootstrap, for files whose lookup missed (`bootstrap.ts:193`); every refinement, for the files the revision re-keyed, plus the affected set and new files (`refinement.ts:260`, `fetchRunnerPart`); a run whose reads grew the closure (`record-tier.ts:227`); and a runner retry. Prune removes a gone worktree's `test_file_keys` and leaves its `test_files` rows (`prune.ts:96`, `WORKTREE_SCOPED_TABLES`). *read in source code.*

The rule asks for the writer's key **now**, not the key the record was written under. So a record goes invalid for this worktree W in four ways, with no change in W's own closure. The fixture (`selection.probe.ts`, `results/steps.txt`) has 13 readers of `start.ts` (the 5 helper readers and the 8 files worker 1b3ef9fa saw) and 20 other files, and it writes rows as those callers do. *verified by experiment:*

| Step | What the store gets | `start.ts` selects |
|---|---|---|
| S0 | X wrote all 33 closures; X and W at one content | 13 of 13 |
| S1 | W edits `start.ts`: content re-key, runner part not applied | **0** of 13 |
| S2 | W's runner part stores the 13 re-keyed closures | 13 of 13 |
| S3 | X edits `src/core/types/index.ts` and stores all 33 | **0** of 13 |
| S4 | W's runs of 3 runtime readers store their grown closures | 3 of 13 |
| S5 | X stores those 3 again; W's runs store the other 5 | 5 of 13, none of S4's 3 |
| S6b | W edits nothing; X moves to another commit | **0** of 13 |
| S7b | X back at W's content, then pruned: 33 records stay, X's keys go | **0** of 13 |

S4 and S5 have the same shape as worker 1b3ef9fa's revisions 6 and 7: 3 files, then 5 other files, and never a helper reader. The fixture shows this shape can come from this rule. It does not show that it came from this rule in that tree, because the tree's store is gone. *inferred.* S7b lasts until a live worktree stores that file's closure again. That happens only when the file misses a lookup at a start, when an edit re-keys it there, or when its run reads a new path. A file nobody edits, whose writer was destroyed, is selected by no source path in any worktree.

**Live, this worktree** (`results/live-samples.txt`, `results/live-reads.txt`). This worktree did not edit any file a test reads; its revisions are writes under `docs/`. *verified by experiment:*

- `start.ts` selected 134 at revision 0 (about 04:33 UTC), 3 from 04:36 to 04:42:21, then 187 from 04:42:43 to the last sample at 04:50:11. `ensure.ts`: 68, 58, then 271. In the 271, the files with a current result rose from 59 to 106 while the count stayed the same. `start-spawned.test.ts` was in none of the 20 samples.
- Before 04:42, every selected file was `unknown`: 58 to 68 of 58 to 68. Lookup-only bootstrap stores the closures of the files whose lookup missed, as this worktree's own records (`bootstrap.ts:193`). Files with an inherited result keep another worktree's record.
- At 04:42:43 `src/core/types/index.ts` selected 160 of the 506 files with a current result and 639 of the 646 unknown ones.
- 65 test files import `main` from `src/cli/main.ts` by value (`results/main-importers.txt`), and `main.ts` imports `startCommand`. At revisions 23 and 29 (04:40:50 and 04:42:25) `main.ts` selected **0**; at 04:42:46 it selected 184.

Which worktree moved at 04:42 is not known without the store.

### 2. Not the edit cut, not a helper miss

**Edit cut.** `fetchEditCut` (`src/core/scheduler/edit-cut.ts:45`) reads the fetched closures and the reverse index. It writes nothing. `fetchRunnerPart` re-resolves every re-keyed file before the cut is computed, and `applyRunnerPart` stores them all, catch-up or not. The cut and the 120 s quiet for catch-up decide *when* a reader runs, not *whether* a source path selects it. *read in source code.*

**Helpers.** A closure holds the transitive static and dynamic imports from Vitest's transform graph (011 C3). In the fixture, the five readers through `start-helpers.ts` are selected whenever their record is valid: 5 of 5 at S0, S2, S6a and S7a. Live at 04:42:52, `start.ts` selected 4 of the 5 helper readers, and `start-helpers.ts` selected 4. *verified by experiment.*

**`lookup-only`.** It changes what is selectable after a start: own records for files with no result, other worktrees' records for files with one. So in a fresh worktree a source-path wait mostly selects files with no result. It ends with "no verdict" (exit 3), and 005 D2 as amended for 011-207 asks no run for a source path. *verified by experiment (the 04:36 to 04:42 samples), read in source code.*

### 3. The wait passes over a reader it did not select

`results/wait.txt`, `results/wait-queued.txt`: one reader's record is X's, and X's key differs. *verified by experiment:*

- `status --wait 3000 src/cli/start.ts` with `start-spawned` failing: exit 0. "Named test files at revision 4: no known failures; 12 test files, each with a current result, after 1.0 s. Worktree: known failures 1 (1 test)".
- The same with `start-spawned` queued: exit 0 after 1013 ms. "... Worktree: known failures 0; not current: 1 of 33 test files (1 queued)".
- Naming `start-spawned.test.ts` too gives exit 1, `result: fail`.

The worktree half of the line names a known failure only after the reader has run here. The exit code and `selection.result` never do.

## Recommendation for Squeal

A fix row: **a source path selects from this worktree's own closures.** The daemon keeps them in its reverse index (`keys.index.reverse.referencing`, which `isCatchUp` and the edit cut already read). They are exactly the closures its keys cover, so no window follows an edit (S1) and no other worktree can change them (S3 to S7). The named wait already needs a synced daemon for a verdict (`status-paths.ts:102`, `status-wait-paths.ts:301`). With no daemon, the store rule stays the fallback. The cost: a read request beside `promote`, and an amendment to 005 D2 ("There is no daemon request" was written for reordering).

Rejected:

- **Store the key the record was written under, and compare it to W's key.** It fixes S6b and S7b, but not S1 or S3, and it needs a schema column.
- **Use any stored closure when the rule fails.** It over-selects. It still misses a reader whose import set differs on another branch, and it gives up 001 D6's rule.

Until the row lands: name the reader test files by their own paths, as the wave-46 brief asks.

## Open questions

- Which of S1, S3, S6b and S7b gave worker 1b3ef9fa's 0, 3 and 5. **Not determined, because** the tree and its store were not kept.
- How often the live selection moves per hour, and how many `test_files` rows name a pruned writer. **Not determined, because** the brief allows no read of the live store; the 20 samples cover 10 minutes.

## Sources

- `src/cli/named-selection.ts:75,143`; `src/core/scheduler/revision.ts:233-284`; `refinement.ts:96-205,229-260`; `record-tier.ts:214-232`; `bootstrap.ts:140-200`; `edit-cut.ts:45-80`; `src/core/store/prune.ts:87-100`; `src/core/store/repos/worktrees.ts:20-28`; `src/cli/status-paths.ts:93-105`; `src/cli/status-wait-paths.ts:287-302`, all at `eec505f3b`.
- Spec 005 D2; spec 011 C3, C7, C10; `tasks/011-219/notes.md`; `test/cli/status-wait-paths.test.ts` ("uses another worktree's closure only while its key for the file is this worktree's").
- Probes: `probes/source-path-selection/` (`selection.probe.ts`, `sample.sh`, `reads.sh`, `results/`).
