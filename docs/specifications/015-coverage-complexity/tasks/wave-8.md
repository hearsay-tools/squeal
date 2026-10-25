# 015 wave 8: a test file is never judged as source, also when it arrives before the runner lists it

Briefed by coordinator 52e58f23 on 2026-10-25, after 0.1.311. One worker.

## W1: 015-52

Use /worker. Shape: repair. Starts from main at 0.1.311. Outcome: a file a runner lists is never counted or judged as source (D1), also when a revision brings it before the runner's listing of that revision, and a session is never told a complexity, `crap` or `uncovered` line about a test file's functions.
- Read `spec.md` D1 ("These are never counted: test files (any file a runner lists)"), D4, D5 and D6, and board row 015-52 with its evidence.
- **Evidence.** In the coordinator's worktree on Squeal 0.1.309, a fast-forward to 0.1.311 (revision 232) brought `test/code/crap/seed.test.ts`. The status header said "The runner part of revision 232 is pending; test files it adds are not counted yet". The code pass counted the file as source: `squeal code test/code/crap/seed.test.ts` lists 61 functions, and all 61 were told as `FAIL uncovered`. Test files added earlier the same day (`test/code/crap/replaced.test.ts`, `sliced.test.ts`, `test/store/table-columns.test.ts`) read 0 functions.
- **Lead.** `source.testFiles()` in `src/core/code/pass/source.ts:58` reads `testFileKeys`, which has no row until the runner lists the file; `workSet` in `pass/pass.ts:218` drops counted files a runner now lists, but only when a later pass runs. Reproduce first, red, through `createCodePass`. Then decide the owner of "this path is a test file" for a revision whose listing is pending, so no function of it is counted, judged or told, and a counted file a runner lists later leaves the store with nothing told.
- **Owns.** `src/core/code/pass/**`, `src/core/code/crap/**` and their tests. Ask before anything else (the runner listing and the scheduler are 011's). By agreement (2026-10-25, request `07557174`, option b; 011's coordinator told): an optional `SchedulerOptions.onRefined` called after each ledger commit that records a refined revision (`#refine` in `src/core/scheduler/runner-work.ts` and the baseline commit), and `src/core/daemon/daemon.ts` passing `onRefined: () => this.#code?.nudge()` through `createDaemonLoop`; about 6 lines, one separate commit, with a scheduler test. 011's conditions (2026-10-25): the hook runs after the ledger transaction commits, never inside it, and its call site catches and logs a throw, so a throwing `onRefined` still leaves the refined revision recorded (tested). No polling timer in the pass.
- **Done when.** Tests, red first: a revision that adds a test file before its listing counts and tells nothing about it; a file counted as source that a runner lists later leaves with nothing told; a source file is still counted. Notes in `tasks/015-52/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. No bundles, no version.

## 015-53: review of candidate 0.1.315 (wave 8)

Use /reviewer. Candidate `cand/0.1.315`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: one scheduler commit by agreement (`SchedulerOptions.onRefined`, 011's conditions), one 015-52 commit, and one build commit (bundles, version 0.1.315). Write `docs/specifications/015-coverage-complexity/reviews/0.1.315.md` and commit it on your branch.

Read `spec.md` D1, D4, D5 and D6, `status.md` (2026-10-25), `tasks/015-52/notes.md`, and this file's W1 with its agreement.

Check, with proof where you can:
1. **D1.** No function of a file a runner lists is counted, judged or told, also when a revision brings it before the runner's listing; a file counted before its listing leaves with no transition told. A source file is still counted, and is never held forever: every revision's listing arrives, also with `lookup-only`, coverage off, an idle daemon, a revision with no test change, a restart while held, and a store 0.1.311 or 0.1.312 left.
2. **`onRefined`.** Called once per committed refined revision (the baseline and each runner part), after the transaction, never while a listing is pending; a throw goes to `onError` and the refinement stays recorded. Unset, the scheduler behaves as before.
3. The `listed:<worktreeId>` meta record: no schema, `user_version`, record or result-key change; readers without it behave as before. Every text without a held or listed test file is byte-identical to main.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## R11: repair of 015-52 after review 0.1.315 (B1, B2, N1)

Use /worker, resumed (worker fcd7c198). Shape: repair. First rebase your branch onto `origin/main` (0.1.313; `daemon.ts` there only loses two `store,` lines). Outcome: a rename while a listing is pending stays one move with nothing told (D2), and only a successful listing releases a held path or drops a counted test file (D1).
- Read `reviews/0.1.315.md` (B1, B2, N1, each with its reproduction and fix boundary).
- **B1.** A held destination must still match its origin by body hash: no origin is resolved before the listing that settles the move, for a deleted file and for a function removed from a file that stays. A lead, not a rule: the pass works only up to the last successfully listed revision and takes each revision whole. Weigh what a long-broken listing then costs, and write it in your notes.
- **B2 and N1.** "This revision's test files were listed" is a fact recorded where it is known, in the scheduler, only when `runner.testFiles` succeeded; a refined revision after a failed listing, a whole-refinement error or an install wait releases nothing. A later successful listing releases and drops, also with no new workspace revision. Keep `onRefined`'s post-commit and throw contract, or replace it by one hook with the same contract.
- **Owns.** As in W1. The scheduler change B2 needs is 011's code: send me the exact files and lines as a request before you edit them; I get 011's agreement.
- **Done when.** Red first: the review's B1 probes (direct and through delivery, told and not told), its B2 failed-listing-then-recovery probe, and N1's listing without a new revision. Notes updated. Lint, typecheck and `squeal run --all --wait` pass; paste the output. No bundles, no version.
