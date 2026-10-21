# Wave 9: the accepted designs' code rows

The human, 2026-10-21: designs 011-61, 011-64 and 011-62 accepted as recommended; at most 3 of the coordinator's workers and reviewers at once. Rows start as slots free. Their base is the `cand/0.1.239` SHA while that candidate is in review, so `src/cli/main.ts` and `src/core/types/status.ts` do not conflict with it.

## W1: 011-75, `failures` by test file, directory and check, with a limit

Use /worker. Shape: slice. Read board row 011-75, `tasks/011-64/design.md` sections 1 and 5 (R1), spec 011 C5 and C6 as amended 2026-10-21 for 011-64. Base: the `cand/0.1.239` SHA named in the spawn.

Seam: `src/cli/failures.ts` (positional paths, `--check`, `--limit`, usage). First edit, a lead: the new `src/core/store/repos/failures.ts` with `list` and `count` `INDEXED BY results_by_failure`, wired in `store.ts`, then `readFailures` in `src/core/status/failures.ts` reads through it.

Tests first, red before: R1's tests 1 to 7 in the design, with the two-worktree seed for test 2.

Owns: `src/cli/failures.ts`, `src/core/status/failures.ts`, the new repo file, `src/core/store/store.ts` (wiring only), the additive types in `src/core/types/store.ts` and `status.ts`, the `squeal failures` line of `HELP` in `src/cli/main.ts`, `docs/commands.md`'s `failures` section, their tests. Not yours: `results.ts`, `schema.ts`, `why*.ts`, `src/core/delivery/`, `test-frame.ts` (011-76), spec text, the board, bundles, version.

Done when: tests 1 to 7 are red before and green after; the cezar-copy timings of section 1's table are in your notes (`tasks/011-75/notes.md`), read-only copy, load beside each; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.

## W2: 011-71, a superseded tier's own running claim ends with it

Use /worker. Shape: slice. Read board row 011-71 and `research/stuck-tier.md` (sections 2 to 4, the open questions). The human, 2026-10-21: fix in 0.1.242. Base: the repaired `cand/0.1.239` commit named in the spawn, which changes `scheduler.ts` and `tiers.ts` since 0.1.238.

Seam: where `recordTier` in `src/core/scheduler/tiers.ts` and `#requeue` in `scheduler.ts` skip a superseded file. First edit, a lead: `probes/stuck-tier/fix.patch`, both hunks, adapted to the base: when the file's `runningKey` is still the tier's key, clear it before the skip.

Tests first, red before: the findings' section 4 list. Move `probes/stuck-tier/stuck-running.test.ts` into `test/scheduler/` with its assertions inverted (the file runs again, the checkpoint completes); the same scenario when recording the tier fails once, so `#requeue` ends it; the same when the tier is not cancelled. `test/scheduler/edit-beside-backlog.test.ts` tests 2 to 4 (review wave-4 B1) pass unchanged.

Owns: `src/core/scheduler/tiers.ts` and `scheduler.ts` (these two paths only), the new tests. Not yours: `yields.ts`, the runners, `startTier`'s transaction (an open question, a later row), spec text, the board, bundles, version.

Done when: the new tests are red before and green after; `test/scheduler/` passes unchanged; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.
