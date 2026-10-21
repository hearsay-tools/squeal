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

## W3: 011-76, the test-file frame beside `location`

Use /worker. Shape: slice. Read board row 011-76, `tasks/011-64/design.md` sections 2 and 5 (R2), spec 011 C5 and C6 as amended 2026-10-21 for 011-64. Base: the reviewed `cand/0.1.239` commit named in the spawn.

Seam: a new pure `testFileFrame` in `src/core/status/test-frame.ts`, read from the stored stack. First edit, a lead: the function and its unit tests (R2's tests 2 and 3), then `src/core/delivery/attribution.ts` gives each failing entry and known failure the frame from the stored row at its key.

Tests first, red before: R2's tests 1 to 5 in the design. Test 2's pytest cases use fixtures from a real pytest run, one per traceback style; say how you made them.

Owns: `src/core/status/test-frame.ts`, `src/core/delivery/attribution.ts`, `src/core/delivery/format.ts` (the `at` line), `src/core/status/format-status.ts` (known failures), `src/core/status/why.ts` and `format-why.ts` (`Location:`), the additive `testFileFrame?` on `TransitionEntry`, `KnownFailure` and `WhyReport`, their tests. Not yours: `src/core/status/failures.ts` and `src/cli/failures.ts` (011-75, held on `w9/011-75`), every adapter, spec text, the board, bundles, version.

Done when: tests 1 to 5 are red before and green after; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## R1: review of cand/0.1.243

Use /reviewer. Shape: review. Pinned to the `cand/0.1.243` SHA named in the spawn; the range is `origin/main..<sha>`: W2 (011-71: the fix, `superseded-claim.test.ts`, its `version-sensitive.txt` line), W1 (011-75) and W3 (011-76) cherry-picked onto 0.1.242 without conflict, and the release commit (0.1.243, bundles; no key-format or `RECORDER_VERSION` change).

Read W1 to W3 above, `research/stuck-tier.md`, `tasks/011-64/design.md` sections 1, 2 and 5 (R1, R2), spec 011 C5 and C6 as amended for 011-64, and `tasks/011-75/notes.md`, `tasks/011-76/notes.md`. Check that:
- 011-71: a superseded file's claim is cleared only when it is still at the tier's own key, in `recordTier` and in `#requeue`, so review wave-4 B1 holds; the three tests fail with each hunk reverted;
- 011-75: the selection runs in SQL through `results_by_failure` (`EXPLAIN QUERY PLAN`); a path typed in a subdirectory selects the same root-relative path in other worktrees; the exit 2 cases; `--check` matches the printed name through the one formatter;
- 011-76: `testFileFrame` is pure and reads V8, node:test and pytest stacks; the frame comes from the stored row at the failure's key and only when that row fails at the same location; `location`, fingerprints and keys do not move; the 10,000-character cap holds; the one `snapshot.ts` line is the agreed one;
- the key format and `RECORDER_VERSION` are rightly unchanged, the version is raised in all eight places, and the bundles match the tree.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. `test/e2e/shipped-plugin.test.ts` fails on this host from a stale npm cache (row 014-17); name it, not a blocker. A file that fails loaded and passes alone is named. Write `reviews/0.1.243.md` with a PASS or FAIL verdict and commit it.
