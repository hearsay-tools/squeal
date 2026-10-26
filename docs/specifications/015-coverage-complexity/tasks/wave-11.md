# 015 wave 11: the writer-feed timing bound has margin on CI

Briefed by coordinator 52e58f23 on 2026-10-26, after 0.1.330. One worker, test files only.

## W1: 015-60

Use /worker. Shape: repair. Starts from main. Outcome: the timing case in `test/code/coverage/writer-feed.test.ts` still fails on the defect it guards and no longer fails on CI noise.
- Read board row 015-60, `tasks/015-55/notes.md` (015-56: on CI a timing test bounds the main thread's CPU time in its longest turn), `test/code/pass/turns.ts`, and the test file.
- **Lead.** `writer-feed.test.ts`, "reconciles 2000 tracked paths within 3x its time while payloads are stored": `expect(beside).toBeLessThan(3 * alone)` read 242.1 against 234.0 ms on main CI 40246921578. The defect (0.1.301) mapped each payload on the main thread, so a pass took about 12 x 200 ms, near 30x alone. Choose the bound from the CI values: the test logs a line starting `reconciliation pass over` in each run (`gh run view <id> --log`). The two leads are a bound on the main thread's CPU time, as 015-56 did, or a wider wall-time ratio.
- **Red first.** Show that the new bound fails when a payload is mapped on the main thread (a local change you do not commit, or a test seam) and passes on main.
- **Owns.** `test/code/coverage/writer-feed.test.ts`; `test/code/pass/turns.ts` only to reuse it, with no change for its current users. No `src/` change.
- **Done when.** The bound fails on the defect shape and has margin over the CI values listed in `tasks/015-60/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both. Run the timing case at most three times locally. No full suite. Do not build bundles or raise the version.
