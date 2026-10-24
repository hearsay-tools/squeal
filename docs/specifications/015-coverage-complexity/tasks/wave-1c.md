# Wave 1c: follow-ups before coverage

Four rows on disjoint seams, all in parallel. The two code rows land as one candidate after a review; the two research rows commit findings only. Wave 2 (015-11, 015-12) is briefed after them: 015-11 needs 013-07 on main.

## W1: 013-07, a project's own coverage setting stays out of Squeal's runs

Use /worker. Shape: slice. Outcome: a project whose Vitest config enables coverage keeps its `coverage/` folder, its stdout and its exit code untouched by Squeal's runs.
- Read the row 013-07 on the board and `research/coverage-collection.md` Q1 and its recommendation 4.
- **Seam.** `#start` in `src/runners/vitest/adapter.ts` (`createVitest("test", {...})`). A lead: pass `coverage: { enabled: false }` in the options until 015 turns its own provider on. Check that a CLI-style override wins over the project's config on Vitest 4 and 5 (V1, V2).
- **Owns.** `src/runners/vitest/adapter.ts`, a new test under `test/runners/vitest/` with a fixture project. Leave `src/core/code/**` to W2.
- **Done when.** A fixture with `coverage: { enabled: true, thresholds }` and an existing `coverage/` folder: after a Squeal run the folder is unchanged, no coverage table reaches the daemon's output, and a failed threshold sets no exit code. Lint, typecheck and `squeal run --all --wait` pass (4 bundle-drift failures expected); paste the output. Do not build bundles or raise the version.

## W2: 015-18, a failed count is retried

Use /worker. Shape: slice. Outcome: a counter that throws once (a transient grammar load or read error) does not leave the file pending until its blob changes.
- Read the row 015-18, `reviews/0.1.283.md` S1, spec D4 ("The pass") and D5.
- **Seam.** `src/core/code/pass/pass.ts`, where a counter error leaves the file uncounted. A lead: record the failed attempt with the blob, retry it on a later pass with a bound (a few attempts, spaced), and read the file as `unknown` meanwhile.
- **Owns.** `src/core/code/pass/**` and its tests under `test/code/pass/`. Leave `src/runners/**` to W1.
- **Done when.** A counter that throws once, then counts: the file is judged on the next pass. A counter that always throws: the file stays `unknown`, with no tight loop and a bounded number of attempts. Lint, typecheck and `squeal run --all --wait` pass (4 bundle-drift failures expected); paste the output. Do not build bundles or raise the version.

## R1: 015-25, `typeof import` in a type argument

Use /researcher. Brief: `research/typeof-import-brief.md`.

## R2: 015-26, progress updates on a failing function

Use /researcher. Brief: `research/progress-updates-brief.md`.

## 015-28: review of candidate 0.1.293

Use /reviewer. Candidate `cand/0.1.293`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>` at 0.1.292: rows 013-07 and 015-18, plus one build commit (bundles, version 0.1.293). Write `docs/specifications/015-coverage-complexity/reviews/0.1.293.md` and commit it on your branch.

Read `spec.md` D3, D4, D6 with their 2026-10-24 amendments, `status.md` (2026-10-24), W1 and W2 above, `tasks/013-07/notes.md` and `tasks/015-18/notes.md`, and 013-07's row on the board.

Check, with proof where you can:
1. **013-07.** A project's own coverage config (enabled, thresholds, a `coverage/` folder) does not reach Squeal's runs on Vitest 4 and 5: the folder, the daemon's output and its exit code are untouched. The test's exit-code check is weak by the worker's own account: judge whether that matters. `VITEST_ADAPTER_VERSION` stays 3 by the coordinator's decision (results survive releases unless a key's meaning changes): check that no stored verdict changes meaning.
2. **015-18.** The retry: three attempts, 5 s and 60 s apart, no early or extra attempts on edits, rewrites or recounts, a fresh budget after a daemon start, a blob counted by another worktree. The grammar-load reset in `count/parser.ts`. The readers: `squeal code`, `counting: N of M`, status `code.uncountable`. No tight loop when the counter always throws. Policy off still byte-identical with no `code.sqlite`.
3. **Residue the worker named**, to weigh: a retry of a failed first count records `first-seen fail` rather than a quiet seed; a retry pass that throws sets no new timer; the Python grammar load keeps a failure.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Under host load, name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## R2: repair of review 0.1.293 B1 to B3 and S1, the retry

Use /worker. Shape: repair. Starts from `int/015c-r1` (013-07 and 015-18 on main, without the 0.1.293 build commit). Outcome: 015-18's retry keeps the delivery model, survives a busy store, and recovers every failed grammar load.
- Read `reviews/0.1.293.md` (B1, B2, B3, S1: each has a reproduction and a repair), spec D4, D5 and D6 with their 2026-10-24 amendments, and `tasks/015-18/notes.md`.
- **B1.** A retry of a failed first count or recount, on a blob that has not changed, seeds quietly (no transition, no session regression). A retry of a session edit still reports its crossing. Keep the origin through adoption from another worktree. Lead: record the origin with the failure in `src/core/code/pass/failed.ts`.
- **B2.** An aborted retry pass re-arms a bounded wake with a positive backoff, outside the success-only path; the attempt budget moves only when a count is attempted.
- **B3.** A failed `pythonParserReady` load (`src/runners/pytest/graph/parse.ts`) is made again at the next count, without re-initialising a live tree-sitter runtime.
- **S1.** The counting line keeps `; N files could not be counted` while other files are pending.
- **Owns.** `src/core/code/pass/**`, `src/core/code/count/parser.ts`, `src/runners/pytest/graph/parse.ts`, `src/core/status/code-status.ts`, and their tests.
- **Done when.** Each review reproduction is a test that fails before and passes after: B1 through delivery and the session regression query, plus a retry after a policy recount; B2 with a real store lock released after an aborted timer pass, recovering without a nudge or an edit; B3 through real `countFile` calls for a failure before runtime init, a Python grammar failure after it, and a TSX failure. Lint, typecheck and `squeal run --all --wait` pass (4 bundle-drift failures expected); paste the output. Do not build bundles or raise the version.

## 015-28 round 2: re-review of candidate 0.1.293

Use /reviewer. Candidate `cand/0.1.293`, pinned to the SHA named in the spawn; round 1 is `reviews/0.1.293.md` (FAIL on 7211f6c1c, B1 to B3). Write `reviews/0.1.293-r2.md` and commit it on your branch. Check the repair R2 against each blocker's reproduction and repair scope, and S1. 013-07 passed round 1: re-read only where the repair touches it. The base moved by the 011 coordinator's wave 31 (tests only). Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result; name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
