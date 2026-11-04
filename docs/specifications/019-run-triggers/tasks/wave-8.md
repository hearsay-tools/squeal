# Spec 019 wave 8: dogfood Round 3 (the human, 2026-11-04: "Round 3 first")

## 019-40 dogfood Round 3: the commit report and the first Stop on 0.1.401

Use /worker. Shape: finish, dogfood. Outcome: `lessons.md` gains "Round 3 (019-40)", judging Goal 5 (a report per commit) and the first Stop in real sessions on 0.1.401, after wave 7's fixes for P8 to P11. Same isolation, rules and record as Rounds 1 and 2 (`lessons.md` "Setup"; Round 2's scripts under `tasks/019-33/bin/`): user `squeal-e2e`, Squeal installed from main's `64ed7667e` by `git archive`, each session on a fresh store, started only at a one-minute load at or below 24, every daemon stopped at the end. Change no product code.

Sessions (`claude -p --model sonnet` unless named), four:
1. The cezarion copy, a task whose last tool call is a `git commit` that adds a lint finding (Round 2's s1c): does the commit line reach the agent, at the boundary or at Stop (P8), is its count right with no stray "not determined" (P11), and does its update arrive once (P9).
2. The fixture, the same with the update stored after the boundary (Round 2's s1f): Stop tells the update once; the agent's report to the user matches it.
3. The fixture, a first Stop with news and an e2e group at `stop`, `stop.maxHolds` 2 (Round 2's s3b, P10): the waiting entry decides, the agent's fix is checked.
4. One Codex session (`gpt-6-astra`) for (3).

Done when: Round 3 is committed with every session's record and a verdict on Goal 5 and the first Stop; each new defect is a proposed row with its reproduction; no daemon of yours is left.
