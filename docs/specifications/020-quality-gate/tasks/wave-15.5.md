# Wave 15.5: repair of candidate 0.1.462 (review `reviews/0.1.462.md` FAIL)

## 020-40 R1 (B1, B2): the kept failed-run log

Use /worker. Shape: repair. Base: `w15/int` at the commit that adds this file. Read `reviews/0.1.462.md` (B1, B2, "Inputs for the repair wave") and `tasks/020-40/notes.md`.
- B1: store opening (`openStore`, `src/cli/code-gate-log.ts:72`) joins the keeper's handled failure path; close only a connection that opened; a busy or failed open gives one bounded "log not kept" note and returns `null`. Regression: an initialisation or migration write lock held before log retention; the CLI still emits one JSON report with its original verdict and exit code.
- B2: the copy must end owned by a row: after the last copy, check the row; if prune removed it, remove the copied folder and return `null` with a note; the same clean-up on errors of that check. No write transaction held while copying. Deterministic regression: a prune between the row insert and the copy leaves either a row-owned folder or no folder.
Keep: the finished row before the report, the 2 s busy bound, the prune owner. Do not change the evaluator, keys, the observed-row merge or the serving-daemon path.
Owns: `src/cli/code-gate-log.ts`, `test/cli/code-gate-log.test.ts`. Done when: both regressions red before and green after; lint, typecheck, `squeal status --wait 60000` on the changed paths. No build, no full suite.
