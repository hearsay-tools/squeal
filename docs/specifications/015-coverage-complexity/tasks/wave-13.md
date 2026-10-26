# 015 wave 13: an exclude change and a move in one pass tell the change once

Briefed by coordinator 52e58f23 on 2026-10-26, from review `reviews/0.1.341.md` B2 and N1, which the human chose to fix after the 0.1.341 release (`status.md`). One worker.

## W1: 015-67

Use /worker. Shape: repair. Starts from main 0.1.341. Outcome: when `coverage.exclude` gains a pattern in the same pass as a move into an existing file it now matches, the summary line counts that file once; a move into an already excluded file stays quiet.
- Read `reviews/0.1.341.md` (B2 with its probe, N1), `reviews/0.1.337.md` B1, `tasks/015-64/notes.md` (R14 part), spec D1, and board row 015-67.
- **Lead.** `moveChecks` and `applyChecks` in `src/core/code/crap/checks.ts` decide the same thing in two places. Give the rule one owner. A first edit to weigh: the move removes coverage states only where the exclude the summary was judged with (`readSummary(...).exclude`) already matches. A file only the new exclude matches is left to `applyChecks`, which removes and counts it. Say in your notes what you chose and why. No scan of every state.
- **Owns.** `src/core/code/**` and its tests. No store, schema, key or text change.
- **Done when.** B2's probe passes through the edit and staged paths, with `excluded: 1` told once. B1's tests still pass. A new test states the first coverage judgement of a function moved out of an excluded file, as D1 says (N1). Notes in `tasks/015-67/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both. No full suite. Do not build bundles or raise the version.

## 015-68: review of candidate 0.1.345 (wave 13)

Use /reviewer. Candidate `cand/0.1.345`, pinned to the SHA in the spawn, on main 0.1.342: W1's three commits (015-67) and the version and bundles. Write `reviews/0.1.345.md` in this spec and commit it on your branch.

Read row 015-67, W1 above, `tasks/015-67/notes.md`, `reviews/0.1.341.md` (B2, N1) and `reviews/0.1.337.md` (B1), and spec D1 and D9.

Check, with proof where you can:
1. **B2.** An exclude change and a move into an existing file it now matches tell `1 file no longer checked` once, through the edit and the staged paths.
2. **B1 holds.** A move into an already excluded file keeps only complexity, quietly.
3. **The gap.** A second move into that file before the step writes the new exclude stays quiet.
4. **N1.** The test's first judgement of a function moved out of an excluded file matches D1 and D9.
5. **One owner.** `withStates` is the one answer to "does this file hold coverage states" for the move and the step; no scan of every state.

Checks (`docs/process.md`): lint, typecheck, Squeal's affected results or targeted `npx vitest run` of files you name. No full suite; name the candidate's CI result or say it is pending. Label findings proven, plausible or unverified. Verdict PASS or FAIL; only a proven break blocks.
