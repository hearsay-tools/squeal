# 015 wave 13: an exclude change and a move in one pass tell the change once

Briefed by coordinator 52e58f23 on 2026-10-26, from review `reviews/0.1.341.md` B2 and N1, which the human chose to fix after the 0.1.341 release (`status.md`). One worker.

## W1: 015-67

Use /worker. Shape: repair. Starts from main 0.1.341. Outcome: when `coverage.exclude` gains a pattern in the same pass as a move into an existing file it now matches, the summary line counts that file once; a move into an already excluded file stays quiet.
- Read `reviews/0.1.341.md` (B2 with its probe, N1), `reviews/0.1.337.md` B1, `tasks/015-64/notes.md` (R14 part), spec D1, and board row 015-67.
- **Lead.** `moveChecks` and `applyChecks` in `src/core/code/crap/checks.ts` decide the same thing in two places. Give the rule one owner. A first edit to weigh: the move removes coverage states only where the exclude the summary was judged with (`readSummary(...).exclude`) already matches. A file only the new exclude matches is left to `applyChecks`, which removes and counts it. Say in your notes what you chose and why. No scan of every state.
- **Owns.** `src/core/code/**` and its tests. No store, schema, key or text change.
- **Done when.** B2's probe passes through the edit and staged paths, with `excluded: 1` told once. B1's tests still pass. A new test states the first coverage judgement of a function moved out of an excluded file, as D1 says (N1). Notes in `tasks/015-67/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both. No full suite. Do not build bundles or raise the version.
