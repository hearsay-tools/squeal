# 015-52 notes: a test file is never judged as source, also before its runner listing

Worker fcd7c198, 2026-10-25. Brief: `tasks/wave-8.md` W1. Starts from main at 0.1.311 (`d506a58ce`). Shape: repair. The pass changes are inside the brief's ownership (`src/core/code/pass/**` and its tests). The scheduler hook is outside it, by agreement: request `07557174`, coordinator 52e58f23, option (b); 011 agreed on two conditions (after the commit, never inside the transaction; a throw goes to `onError` and fails nothing). No bundles, no version, no key change.

## The two causes

Both are reproduced red through `createCodePass` in `test/code/pass/unlisted.test.ts`.

1. **The pass counted a file that the runner had not listed yet.** `PassSource.testFiles()` reads `testFileKeys`. A test file has no row there until the runner part of its revision is applied. The pass ran at `afterBatch`, as soon as the revision was stored, so it counted the file as source. With coverage on, the coverage step then judged every function `uncovered`, because no test file loads it. This is the evidence: 61 functions of `test/code/crap/seed.test.ts`, all told `FAIL uncovered`.
2. **The pass never removed it after the listing.** `workSet` adds counted files that a runner lists, but `runPass` returned early when no revision came after the cursor. The listing comes with no new revision, so the file stayed until the next edit. When it was removed, `judge` and `removedFailures` recorded `removed` transitions for each failing complexity, `crap` and `uncovered` state, and the delivery told each one as "no longer in the code".

## What changed

- **The scheduler says when a listing is applied** (`b834d60f2`, by agreement). `SchedulerOptions.onRefined` is called after each committed transaction that records a refined revision: the baseline (`TierScheduler.#baseline`) and a revision's runner part (`RunnerWork.#refine`). It is never called while that runner part is pending. A throw goes to `onError` and the refined revision stays recorded. The daemon passes `onRefined: () => code.nudge()`. Test: `test/scheduler/on-refined.test.ts`.
- **The pass reads the listed revision** (`pass/types.ts`, `pass/source.ts`). `PassSource.listedRevision()` gives the scheduler's refined revision (`refinedMetaKey`), at most the latest. With no record, it gives the latest, as the status header reads it. The pass reads it before `testFiles()`, so the test files hold each listing up to that revision.
- **The pass holds a file that may be a test file** (`pass/listed.ts`, `holdUnlisted`). A file is held when it has no files row (the pass never counted it) and a revision after the listed one changed it. A held file gets no files row, no count, no state and no transition. A file the pass counted before is not held: an edit to it is counted at once, as before. The rule applies to every pass mode: edit, first count and recount.
- **The pass reads held files again after their listing** (`listed.ts`, code meta `listed:<worktreeId>`). The record holds the listed revision at the last pass and whether that pass held files. A pass runs when the listed revision is not the recorded one, also with no new revision. It reads again every file changed after the recorded revision that still has no files row (`heldPaths`). A listed test file then is not included. A source file is counted and judged as an edit pass judges a new file. The record is in the code store, so a held file is still read again after a daemon restart.
- **A held file keeps its provenance** (`changesFrom`, `committedWithHeld`). Its last change came before the cursor. The too-big edit record (015-39) reads the changes from the recorded listed revision. `committedPaths` (015-19, 015-38) asks for held files from that revision too, so a pull that brought a new source file is still git's after the hold. The other files ask from the cursor, as before.
- **A counted file that a runner now lists leaves quietly** (`pass/plan.ts`, `quietPaths`). Its entry is `gone` because `includedSet` excludes listed test files. Its path joins B1's quiet set, so `judge` records no `removed` transition and `removedFailures` tells none of its `crap` or `uncovered` states. `states.removeMany` removes every measure's state. The told line (`toldOver`) reads failing states, so it no longer counts those functions.
- **A listing with nothing to read makes no pass.** When only the listing moved and the work set is empty, the pass writes the record and returns `null`. So the coverage step does not invalidate its loader map at every refinement.
- **`pass.ts` stays under 300 lines.** `workEntries`, `workSet`, `quietPaths` and `plan` moved to `pass/plan.ts`. `runPass` is CC 18.

## Decisions the spec did not settle

1. **The owner of "this path is a test file" while a listing is pending is the runner listing, and the pass waits for it.** A second owner (the runner's include globs in the pass) could disagree with the runner. The cost: a new source file's complexity waits for its revision's runner part. An edit to a file already counted does not wait.
2. **How the pass learns that the listing arrived: the scheduler's `onRefined`** (the coordinator's option (b)), not a timer in the pass.
3. **A held file is judged as an edit pass judges a new file, also when a recount held it.** The recount did not count it, so its summary line does not include it. Judging it quietly would mean the session never hears of it.

## Limits

- **A held file released at a recount's revision is not told.** If a revision changes the policy (a recount) and also brings a new source file over the threshold before its listing, the pass judges the file at the same revision as the recount. The delivery takes every change at or before the recount's revision into the view by count (D6), so no line tells it, and the summary did not count it. `squeal code` and status count it. Test: "holds a test file in a recount, and counts a held source file once listed".
- **A refinement that throws counts a new test file as source.** `RunnerWork.#refinedAfterError` records the revision as refined with no listing and calls no `onRefined` (the contract names only ledger commits). A file held for that revision waits for the next pass, which then counts it, and can tell it. A test file among them leaves quietly at the next listing that moves the refined revision.
- **A runner-only refinement does not move the listed revision.** A recheck (`queueRecheck`) can list a file with no refined commit, so no pass runs for it. A counted file it lists leaves quietly at the next revision.
- **While a daemon waits for an install, nothing is held.** `reconcileWaiting` records each revision as refined with nothing listed. A test file added meanwhile is counted as source. It leaves quietly at the install's baseline listing.

## For the next worker

- Coverage stays off in this repository until this row is released (`status.md`, 2026-10-25).
- The bundle tests (`test/harness/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts`) fail on this branch: the brief says no bundles, so they drift until the coordinator builds them.
