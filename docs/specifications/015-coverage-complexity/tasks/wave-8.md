# 015 wave 8: a test file is never judged as source, also when it arrives before the runner lists it

Briefed by coordinator 52e58f23 on 2026-10-25, after 0.1.311. One worker.

## W1: 015-52

Use /worker. Shape: repair. Starts from main at 0.1.311. Outcome: a file a runner lists is never counted or judged as source (D1), also when a revision brings it before the runner's listing of that revision, and a session is never told a complexity, `crap` or `uncovered` line about a test file's functions.
- Read `spec.md` D1 ("These are never counted: test files (any file a runner lists)"), D4, D5 and D6, and board row 015-52 with its evidence.
- **Evidence.** In the coordinator's worktree on Squeal 0.1.309, a fast-forward to 0.1.311 (revision 232) brought `test/code/crap/seed.test.ts`. The status header said "The runner part of revision 232 is pending; test files it adds are not counted yet". The code pass counted the file as source: `squeal code test/code/crap/seed.test.ts` lists 61 functions, and all 61 were told as `FAIL uncovered`. Test files added earlier the same day (`test/code/crap/replaced.test.ts`, `sliced.test.ts`, `test/store/table-columns.test.ts`) read 0 functions.
- **Lead.** `source.testFiles()` in `src/core/code/pass/source.ts:58` reads `testFileKeys`, which has no row until the runner lists the file; `workSet` in `pass/pass.ts:218` drops counted files a runner now lists, but only when a later pass runs. Reproduce first, red, through `createCodePass`. Then decide the owner of "this path is a test file" for a revision whose listing is pending, so no function of it is counted, judged or told, and a counted file a runner lists later leaves the store with nothing told.
- **Owns.** `src/core/code/pass/**`, `src/core/code/crap/**` and their tests. Ask before anything else (the runner listing and the scheduler are 011's).
- **Done when.** Tests, red first: a revision that adds a test file before its listing counts and tells nothing about it; a file counted as source that a runner lists later leaves with nothing told; a source file is still counted. Notes in `tasks/015-52/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. No bundles, no version.
