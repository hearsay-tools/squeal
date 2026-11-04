# Spec 019 wave 5: what the dogfood found

From `lessons.md` Round 1 (019-17), proposed rows P1 to P7, each with its reproduction and done-when there. The coordinator took each row's default (2026-11-04; the human may override): P2 option (a), P5 option (a). Four rows in parallel on disjoint files, from cand/0.1.399. One candidate, one review.

## 019-28 the commit report counts only the commit's own work (P1, P4)

Use /worker. Shape: repair. P1: running and waiting count only files a commit group asked for at their key; other pending files are left out of the report (or named by their moment), and the update never waits for them. P4: the lint part counts the files the commit changed; an untracked file that no key reads makes nothing not determined; "(unstaged changes)" only for files staged differently. Owns `src/core/scheduler/head-move.ts`, `commit-moment.ts`, `commit-asks.ts`, `src/core/commit/*` except `boundary.ts`, tests. Done when: the P1 and P4 done-when tests in `lessons.md` pass; the Part A e2e test (`test/e2e/run-triggers.test.ts`) still passes when it commits before Stop (change that ordering back); lint and typecheck.

## 019-29 the commit line reaches an agent whose commit is its last tool call (P2, option a)

Use /worker. Shape: repair. The tool boundary that sees `HEAD` move waits up to 500 ms, inside the hook's 2 s, for the daemon's pass to store the report, and carries the commit line in that same delivery; a boundary with no `HEAD` move waits for nothing. Owns `src/harness/shared/deliver.ts`, `src/core/commit/boundary.ts`, `src/core/delivery/commit-told.ts`, tests. Done when: the P2 done-when test (a real daemon); the boundary latency tests stay within their bounds; lint and typecheck.

## 019-30 Stop's first hold, last hold and a predecessor that never starts (P3, P5 option a, P6)

Use /worker. Shape: repair. P3: at a session's first Stop, when a group Stop waits for exists and the harness has a waiting entry, the 2 s entry waits up to 500 ms for the waiting entry's record before it decides, or its hold before the record does not count. P5 (a): a hold at the bound for a group that never started names why ("they run after unit, which has 872 files pending"). P6: a hold that spends the last one says so and names the group's run command. Owns `src/harness/shared/stop.ts`, `stop-decide.ts`, `stop-slow.ts`, `text.ts`, `src/core/state/required.ts`, tests. Done when: the P3, P5 and P6 done-when tests on Claude Code and Codex; texts without `checks` byte-identical; lint and typecheck.

## 019-31 Codex end-to-end tests run the release under test (P7)

Use /worker. Shape: repair. `test/e2e/harness.ts` selects this worktree's `plugins/codex-runtime` for Codex fixtures by default (as `pluginAt` does in `test/e2e/run-triggers-support.ts`); the tests that mean the seed say so. Owns `test/e2e/harness.ts` and the Codex e2e tests that need a flag. Done when: a Codex fixture's `squeal --version` through its hooks is `package.json`'s version; the seed tests still pass; run the Codex e2e files directly (Squeal does not cover `test/e2e/**`).
