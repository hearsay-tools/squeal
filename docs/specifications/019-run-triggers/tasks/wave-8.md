# Spec 019 wave 8: dogfood Round 3 (the human, 2026-11-04: "Round 3 first")

## 019-40 dogfood Round 3: the commit report and the first Stop on 0.1.401

Use /worker. Shape: finish, dogfood. Outcome: `lessons.md` gains "Round 3 (019-40)", judging Goal 5 (a report per commit) and the first Stop in real sessions on 0.1.401, after wave 7's fixes for P8 to P11. Same isolation, rules and record as Rounds 1 and 2 (`lessons.md` "Setup"; Round 2's scripts under `tasks/019-33/bin/`): user `squeal-e2e`, Squeal installed from main's `64ed7667e` by `git archive`, each session on a fresh store, started only at a one-minute load at or below 24, every daemon stopped at the end. Change no product code.

Sessions (`claude -p --model sonnet` unless named), four:
1. The cezarion copy, a task whose last tool call is a `git commit` that adds a lint finding (Round 2's s1c): does the commit line reach the agent, at the boundary or at Stop (P8), is its count right with no stray "not determined" (P11), and does its update arrive once (P9).
2. The fixture, the same with the update stored after the boundary (Round 2's s1f): Stop tells the update once; the agent's report to the user matches it.
3. The fixture, a first Stop with news and an e2e group at `stop`, `stop.maxHolds` 2 (Round 2's s3b, P10): the waiting entry decides, the agent's fix is checked.
4. One Codex session (`gpt-6-astra`) for (3).

Done when: Round 3 is committed with every session's record and a verdict on Goal 5 and the first Stop; each new defect is a proposed row with its reproduction; no daemon of yours is left.

## Before the 0.1.401 release (the human, 2026-11-04: "B: fix first")

Three rows in parallel on disjoint files, from main. One candidate (0.1.402), one review, then the release.

### 019-42 `wait-reads.test.ts` counts one poll too many on a slow runner

Use /worker. Shape: repair. CI 41810579375 at `64ed7667e`: `test/cli/wait-reads.test.ts` > "status --wait <path> reads the selected files' states, and every state only at its end": `expected 7 to be less than or equal to 6` in `between` (line 54). First prove whether spec 019's changes to `src/cli/status-wait-lines.ts` and `status-wait-paths.ts` (rows 019-24, 019-25; `git log -p` on them since `b1255533f`) added a read or a poll per second: count reads per poll at `b1255533f` and at main with a probe. If they did, remove the extra read. If not, make the test's bound follow the wait's real clock (for example count polls against elapsed seconds) rather than a fixed 6. Owns `test/cli/wait-reads.test.ts` and, only if a read was added, `src/cli/status-wait*.ts`. Done when: the cause is named in `tasks/019-42/notes.md` with the probe's numbers; the test passes 10 runs in a row at the host's current load (stated); lint and typecheck.

### 019-41 `run-triggers-control.test.ts` still fails at random on CI

Use /worker. Shape: repair. Main CI 41773837324 at `529d3b01b`, Node 22 shard 1, claude-code: "expected [ null, …(4) ] to deeply equal [ null, …(4) ]" (deliveries of the two versions differ). Read the failing assertion and the deliveries it compares, find the remaining race, and make the control compare what must be equal without depending on which boundary or poll carried a delivery; it must still catch a changed, missing or extra text (review `reviews/0.1.399-r2.md` probes). Owns `test/e2e/run-triggers-control.test.ts`, `run-triggers-moments.ts`, `run-triggers-fixture.ts` (not `run-triggers-support.ts`'s `pluginAt`). Done when: the race is named in `tasks/019-41/notes.md`; the control passes 10 runs in a row directly (Squeal does not cover `test/e2e/**`), with the host load stated; lint and typecheck.

### 019-39 a hung `git hash-object` holds the scheduler lock for at most a short bound

Use /worker. Shape: repair. Review `reviews/0.1.401-r2.md` N1: the commit report's one batched `git hash-object --stdin-paths` (`src/core/commit/stored.ts`) waits up to 30 s under the scheduler lock when git hangs. Bound it at about 2 s, after which every path stays different (not determined), and if cheap call it outside the lock. Owns `src/core/commit/stored.ts`, `compute.ts`, their tests. Done when: a test with a stalled git shim shows a watch batch held no longer than the bound and the report reads not determined; affected tests by `squeal status --wait`; lint and typecheck. No build.

### 019-43 a lint group at commit tells the agent which finding (P12; the human, 2026-11-04: "Fix in 0.1.402")

Use /worker. Shape: repair. `lessons.md` Round 3 P12: when lint runs only at commit, a committed file's finding records no change event, so no `FAIL lint:` line (file, line, rule, message) reaches the agent; only the commit line's count does. Also status says "linting, 1 of 3 files" when nothing lints. Fix: a lint check that a commit's lint group ran and that ended as a finding is news like an edit-time finding: the agent gets its `FAIL lint:` line once, with the commit line or its update, at the next boundary or at Stop (019-38's path). A finding the agent already saw is not repeated. Status counts only lint actually running. Read `tasks/019-22/notes.md` and `tasks/019-38/notes.md` first. Owns the lint pass's commit entry and its record (`src/core/lint/pass/commit-entry.ts`, `records.ts` record step), the delivery's lint news (`src/core/delivery/` lint parts), the status lint line (`src/core/status/` lint part), tests. Leave `src/core/commit/stored.ts` and `compute.ts` to 019-39. Done when: a real-daemon test where a commit adds a lint finding as the agent's last tool call: the agent gets the `FAIL lint:` line with file, line and rule once (at the boundary or at Stop), on Claude Code and Codex; status shows no "linting" after the pass ends; texts without `checks` byte-identical; lint and typecheck. No build.
