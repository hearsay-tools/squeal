# Spec 019 wave 6: dogfood Round 2, and the e2e lint wait

From main at 0.1.400 (`636d2088f`), after wave 5 fixed the dogfood's P1 to P7. Two rows in parallel on disjoint files.

## 019-33 dogfood Round 2: the commit report and Stop's holds in real sessions

Use /worker. Shape: finish, dogfood. Outcome: `lessons.md` gains "Round 2 (019-33)", judging Goal 5 (a report per commit) again, and P3, P5 and P6 in real sessions, on 0.1.400. Same isolation, rules and record as Round 1 (`lessons.md` "Setup", `tasks/wave-4.md` 019-17 Part B): user `squeal-e2e`, Squeal installed from `636d2088f` by `git archive`, sessions started only at a one-minute load at or below 24, every daemon stopped at the end.

Sessions (`claude -p --model sonnet` unless named): (1) a task whose last tool call is a `git commit` that adds a lint finding: does the commit line reach the agent, is it right, and does its update arrive once (P1, P2, P4); (2) the same as (1) beside an untracked notes file and with a partly staged file (P4); (3) a Stop that waits for an e2e group with `stop.maxHolds` 1, then 2: the first hold waits (P3), the last hold says so (P6); (4) the cezarion copy: Stop for its e2e group behind a large unit backlog (P5's wording); (5) one Codex session (`gpt-6-astra`) for (3) with the `stop-slow` hook trusted again. Reuse Round 1's scripts under `tasks/019-17/bin/`; give each session a fresh store.

Done when: Round 2 is committed with every session's record and a verdict per Goal 1 to 6; each new defect is a proposed row with its reproduction; no daemon of yours is left. Change no product code.

## 019-34 the end-to-end test waits for lint before its first check

Use /worker. Shape: repair. Review `reviews/0.1.400.md` (the lint-baseline note): `settleEdit` in `test/e2e/run-triggers*.ts` waits only for test counts, so its first check can run before the lint pass lists its files. Make the baseline wait require `lint.files === 3` and `pending === 3` before asserting, as the review says. Also bring `E2E.#build` in `test/e2e/harness.ts` (complexity 23) under 20 with no behaviour change. Owns `test/e2e/run-triggers*.ts` and `test/e2e/harness.ts`. Done when: `test/e2e/run-triggers.test.ts` and `run-triggers-control.test.ts` pass three runs in a row, run directly (Squeal does not cover `test/e2e/**`); one Codex e2e file that uses the harness passes; lint and typecheck.
