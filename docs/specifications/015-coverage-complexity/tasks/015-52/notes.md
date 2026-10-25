# 015-52 notes: a test file is never judged as source, also before its runner listing

Worker fcd7c198, 2026-10-25. Briefs: `tasks/wave-8.md` W1, then R11 (repair after review 0.1.315: B1, B2, N1). Shape: repair. Rebased onto `origin/main` at 0.1.313 (`c7ab3c0a9`). The pass changes are inside the brief's ownership (`src/core/code/pass/**` and its tests). The scheduler part is outside it, by agreement, in one commit of its own (`15c7e389f`): requests `07557174`, `9e9fe36a`, `bf3feab6` and `e86a66d4`, coordinator 52e58f23, with 011's conditions. No bundles, no version, no key change.

## The causes

W1, both reproduced red through `createCodePass` in `test/code/pass/unlisted.test.ts`:

1. **The pass counted a file that the runner had not listed yet.** `PassSource.testFiles()` reads `testFileKeys`. A test file has no row there until the runner part of its revision is applied. The pass ran at `afterBatch`, as soon as the revision was stored, so it counted the file as source. With coverage on, the coverage step then judged every function `uncovered`, because no test file loads it. This is the evidence: 61 functions of `test/code/crap/seed.test.ts`, all told `FAIL uncovered`.
2. **The pass never removed it after the listing.** `runPass` returned early when no revision came after the cursor, and the listing comes with no new revision. When it was removed, each failing state was told as "no longer in the code".

R11, each reproduced red against the W1 pass (scratch worktree at `c60622e58`; output kept in `.ai/cezar/t/fcd7c198/r11-red.txt`):

3. **B1: holding the new path of a move split the move.** The origin was removed at once, and the destination was counted later as a new function. A rename was told RESOLVED, then FAIL (D2). Tests: `test/code/pass/unlisted-move.test.ts`, at the pass and through the delivery, told and not yet told.
4. **B2: a refined revision proves no listing.** After `runner.testFiles` rejected, the runner part still recorded its revision as refined, and the pass released the held files against the old test list. It counted `test/new.test.ts` as source. Test: `test/code/pass/listing-failed.test.ts`, through a real scheduler and `createCodePass` wired as in the daemon.
5. **N1: a listing with no new revision did not move `listedRevision`**, so a counted test file it listed stayed. Test: "removes with nothing told a counted test file that a listing at the same revision lists" in `unlisted.test.ts`.

## What changed

- **The scheduler records each listing that did not fail** (`15c7e389f`). `listing:<worktreeId>` in the main store's meta (`listingMetaKey`, `ListingFact`: `{revision, count}`) is written in the same ledger transaction as the refined revision, only when the baseline's or a runner part's listing did not fail. A failed `testFiles`, a refinement that throws and an install wait record none. `count` grows at each listing, so a listing at the same revision is news too (N1). `SchedulerOptions.onListed` replaces W1's `onRefined` with the same contract: called after the committed transaction, never inside it; a throw goes to `onError` and fails nothing. The daemon passes `onListed: () => code.nudge()`. A runner part that throws sets `listingFailed` (request `e86a66d4`): what it listed is not known, so the next runner part lists again, and none records a listing until one applies. Before, a throw before `applyListing` let the next runner part with no added or deleted file carry the last listing forward over the thrown revision. Test: `test/scheduler/on-listed.test.ts`, the throw injected in the test through a recreate and an environment file outside the worktree.
- **The pass reads that record** (`pass/source.ts`, `PassSource.listing()`). `null` when none is recorded: then no file is known not to be a test file.
- **The pass holds a file that may be a test file** (`pass/listed.ts`, `holdUnlisted`). A file is held when it has no files row (the pass never counted it) and a revision after the listed one changed it, or, with no listing recorded, any such file. A held file gets no files row, count, state or transition. A file the pass counted before is not held: an edit to it is counted at once.
- **While a file waits, an edit pass's removals wait with it** (B1, `holdRemovals`). The pass judges as before, then takes back each removal whose path is not quiet: its states, views and history stay, and no `removed` transition, `crap` or `uncovered` removal is told. The paths go into the record (`deferred`). Each later pass reads them again, with the waiting files. At the first pass where nothing waits, the origin and the destination are judged together, and `judge` pairs the move by body hash (D2): nothing is told, and the state keeps its history and views. `oldBodies` reads a deferred path with no files row in the language of its extension. `plan` keeps a deferred path that is gone, so it is read also in a recount.
- **A recount waits for the listing of a file it would hold** (`workEntries` returns `null`). This covers a first count, a switch-on and a policy change. When the listing comes, `onListed` runs the recount again, and its summary line counts the released file (D5, D6). The code pass keeps `switchedOn` across such a wait (`pass/index.ts`). Test: "waits with the first count while the start's listing fails…" in `listing-failed.test.ts`, red against the W1 pass and against an intermediate version that read a missing listing as revision 0.
- **The record** (code meta `listed:<worktreeId>`): `listed`, the listing fact at the last pass; `since`, the revision that waiting changes came after (`null` when nothing waits); and `deferred`. A pass runs when the fact changed, also with no new revision. It reads again every file changed after `since` that still has no files row, and the deferred paths (`waitingPaths`). The record is in the code store, so a daemon restart keeps it.
- **A waiting file keeps its provenance** (`changesFrom`, `committedWithHeld`). The too-big edit record (015-39) and `committedPaths` (015-19, 015-38) read a waiting path's change from `since`, so a pull that brought a new source file is still git's after the wait.
- **A counted file that a runner now lists leaves quietly** (W1, `plan.ts`, `quietPaths`). Its entry is `gone`, its path joins B1's quiet set, and nothing is told.
- **`runPass` is CC 19 and `pass.ts` 299 lines.**

## Decisions the spec did not settle

1. **The owner of "this path is a test file" is the runner's listing, and the pass waits for it.** A second owner (the runner's include globs in the pass) could disagree with the runner.
2. **The listing fact is recorded where it is known**, in the scheduler's ledger transaction, and the pass only reads it (styleguide: record a fact where it is known). A refined revision is not used as a proxy.
3. **B1 holds removals, not the whole pass.** The review's lead was to work only up to the last listed revision and take each revision whole. I did not take it. The stat cache gives only the latest bytes of a file, so the pass cannot judge an older revision's text; and a long-broken listing would stop every complexity result, edits to counted files too. Holding only the removals keeps edits judged at once and makes every move one move.
4. **A recount waits instead of holding.** Holding files in a recount would judge them later as new files and tell each one: on a fresh worktree whose start listing failed, that is every function over the threshold. Holding removals in a recount would tell RESOLVED later for functions that a policy change removed with no transition. A recount that waits has neither problem.
5. **A missing listing record is "nothing listed", not revision 0.** The coordinator approved "absent read as 0" (request `9e9fe36a`). The probe showed that revision 0 then counted the start's own test files as source when the start's listing failed. So `listing()` gives `null`, and every file never counted waits. On a normal start, the baseline records its listing before the first pass.

## What a long-broken listing costs

When `runner.testFiles` keeps failing (for example a Vitest config that does not load), or a listing never comes:

- **New files are not counted.** A file the pass never counted waits. `squeal code` and status do not show it, and the session hears nothing of it.
- **Removals wait while any file waits.** A function deleted, or moved into a waiting file, keeps its states: status, `squeal code` and the told line still count a deleted failure, and RESOLVED comes only after the listing. A move between two counted files is still judged at once.
- **A recount waits while any file waits.** After a policy change or a counter upgrade, results stay at the old policy. On a fresh worktree, nothing is counted.
- **Edits to counted files go on as before.**
- **Each edit pass reads more.** It reads again every path changed since the oldest waiting revision that has no files row, and the deferred paths. That is a revision-range read and a files-row lookup per pass, which grow with the revisions since the last listing. The waiting files are not counted again.
- **When the listing comes**, one pass releases everything at once: new files are judged as new (told), moves pair, and the removals that waited are told.

## Limits

- **After a runner part that throws, every later runner part lists again until one applies.** That is one more `runner.testFiles` call per runner part while the cause stays, and the held files wait as for a failed listing.
- **A removal waits for any waiting file**, not only for the file that a move goes to. The pass cannot know where a function went before the destination is read.
- **A function moved into a file that waits and then removed there** before the listing is a removal at release, with nothing moved.

## For the next worker

- Coverage stays off in this repository until this row is released (`status.md`, 2026-10-25).
- The bundle tests (`test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts`) fail on this branch: the brief says no bundles, so they drift until the coordinator builds them.
