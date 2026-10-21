# Wave 9: the accepted designs' code rows

The human, 2026-10-21: designs 011-61, 011-64 and 011-62 accepted as recommended; at most 3 of the coordinator's workers and reviewers at once. Rows start as slots free. Their base is the `cand/0.1.239` SHA while that candidate is in review, so `src/cli/main.ts` and `src/core/types/status.ts` do not conflict with it.

## W1: 011-75, `failures` by test file, directory and check, with a limit

Use /worker. Shape: slice. Read board row 011-75, `tasks/011-64/design.md` sections 1 and 5 (R1), spec 011 C5 and C6 as amended 2026-10-21 for 011-64. Base: the `cand/0.1.239` SHA named in the spawn.

Seam: `src/cli/failures.ts` (positional paths, `--check`, `--limit`, usage). First edit, a lead: the new `src/core/store/repos/failures.ts` with `list` and `count` `INDEXED BY results_by_failure`, wired in `store.ts`, then `readFailures` in `src/core/status/failures.ts` reads through it.

Tests first, red before: R1's tests 1 to 7 in the design, with the two-worktree seed for test 2.

Owns: `src/cli/failures.ts`, `src/core/status/failures.ts`, the new repo file, `src/core/store/store.ts` (wiring only), the additive types in `src/core/types/store.ts` and `status.ts`, the `squeal failures` line of `HELP` in `src/cli/main.ts`, `docs/commands.md`'s `failures` section, their tests. Not yours: `results.ts`, `schema.ts`, `why*.ts`, `src/core/delivery/`, `test-frame.ts` (011-76), spec text, the board, bundles, version.

Done when: tests 1 to 7 are red before and green after; the cezar-copy timings of section 1's table are in your notes (`tasks/011-75/notes.md`), read-only copy, load beside each; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.
