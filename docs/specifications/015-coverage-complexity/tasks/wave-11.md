# 015 wave 11: the writer-feed timing bound has margin on CI

Briefed by coordinator 52e58f23 on 2026-10-26, after 0.1.330. One worker, test files only.

## W1: 015-60

Use /worker. Shape: repair. Starts from main. Outcome: the timing case in `test/code/coverage/writer-feed.test.ts` still fails on the defect it guards and no longer fails on CI noise.
- Read board row 015-60, `tasks/015-55/notes.md` (015-56: on CI a timing test bounds the main thread's CPU time in its longest turn), `test/code/pass/turns.ts`, and the test file.
- **Lead.** `writer-feed.test.ts`, "reconciles 2000 tracked paths within 3x its time while payloads are stored": `expect(beside).toBeLessThan(3 * alone)` read 242.1 against 234.0 ms on main CI 40246921578. The defect (0.1.301) mapped each payload on the main thread, so a pass took about 12 x 200 ms, near 30x alone. Choose the bound from the CI values: the test logs a line starting `reconciliation pass over` in each run (`gh run view <id> --log`). The two leads are a bound on the main thread's CPU time, as 015-56 did, or a wider wall-time ratio.
- **Red first.** Show that the new bound fails when a payload is mapped on the main thread (a local change you do not commit, or a test seam) and passes on main.
- **Owns.** `test/code/coverage/writer-feed.test.ts`; `test/code/pass/turns.ts` only to reuse it, with no change for its current users. No `src/` change.
- **Done when.** The bound fails on the defect shape and has margin over the CI values listed in `tasks/015-60/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both. Run the timing case at most three times locally. No full suite. Do not build bundles or raise the version.

## 015-63: review of candidate 015-60 (wave 11)

Use /reviewer. Candidate `cand/015-60`, pinned to the SHA named in the spawn: two commits on main 0.1.331, the test change and its notes. No bundle or version change. Write `docs/specifications/015-coverage-complexity/reviews/015-60.md` and commit it on your branch.

Read board row 015-60, this file's W1, and `tasks/015-60/notes.md`.

Check, with proof where you can:
1. **Catches the defect.** With payloads mapped on the main thread (`worker: null`), the new bound fails; on the worker thread it passes. The old 3x ratio passed the defect shape, as the notes say.
2. **Margin on CI.** The bound (half of one payload's map CPU time) holds over the CI values in the notes, and the candidate's CI run logs the new values below it. Thread CPU time is read with `process.threadCpuUsage` on Node 22.19 and 24.
3. **No weaker check.** The `busy` check and the load skip stay; nothing else in the file loosens.

Checks (`docs/process.md`, test runs on a shared host): lint, typecheck, Squeal's affected result for the test, and the timing case at most twice locally. No full suite; CI run 40258232216 on the candidate is the full suite, so name its result or that it is pending. Label every finding as proven, plausible or unverified. Verdict: PASS or FAIL; only a proven break blocks.
