# Wave 83.5: repair of row 011-327 after review 0.1.474

Coordinator cdd216e5, 2026-11-13. Review `reviews/0.1.474.md` FAIL on `cand/0.1.474` at `9d70cdb1f`: one blocker, B1. N1 (a read beside the checkpoint wait, `filesText`, still throws on a busy worktree store) is nonblocking and stays outside this repair; it becomes a proposed row.

## W1: repair B1

Use /worker. Worker 664d4f3e, resumed in its own worktree. Shape: repair, test first.

Outcome: a busy lint store is read again until the deadline's read, as the worktree store is; a damaged or unreadable lint store still ends the wait as today.

Read: `reviews/0.1.474.md` B1 (from the shared object store: `git show be35d8346:docs/specifications/011-core/reviews/0.1.474.md`); your notes, decision 6.

Seam and lead: `lintCounts` in `src/cli/wait/reads.ts` and the lint row of `RUN_WAITS` in `table.ts`. `withLint` (`src/core/lint/surface/source.ts`) turns every error into `failed`; `isBusy` (`src/core/store/connection.ts`) tells a busy error. Prefer a CLI-only read: open through `lintStoreSource(commonDir, root, { busyTimeoutMs })` with `readBound`'s timeout, run the counts read, and classify a thrown error with `isBusy`, at the open as well as in the read. The lint chain then takes the worktree rows' rules: busy before the deadline goes on; busy at the deadline's read ends with the busy reason, exit 3; any other failure stays `unread`.

First edit: the two loop rows B1 asks for, over a real lock (a second connection holding `BEGIN EXCLUSIVE` on the lint store): released at the first pause, the next read gives the verdict; held through the deadline, the deadline's read ends with the busy reason. Then the pure rows.

Owns: `src/cli/wait/**`, `test/cli/wait/**`, `run-lint-group.ts` wording if the busy line needs it, your notes. Leave alone: everything W1 of `wave-83.md` leaves alone, `src/core/lint/` included. If the busy error cannot be told without a `src/core` change, stop and ask the coordinator.

Done when: both B1 rows pass; a damaged lint store still ends `unread`; lint and typecheck pass; affected results through `squeal status --wait 60000 <paths>`; the notes' decision 6 and the line list say what changed. One commit for the tests, one for the change.

## R2: narrow re-review

Use /reviewer (codex gpt-6.1-sol high), pinned to `cand/0.1.474-r2` at `d9bbd5ca6ae3814eaea779062636149ed0f0cbe8`; candidate CI 43514771995. The candidate is `5042e9b67` plus the reviewed eight commits (`dfe5212dc..d7c6ccbe7` as rebased: `b84124ca6` and before), the three repair commits of worker 664d4f3e (`6fb7c6182` tests, `ae2925179` change, `df02a710c` notes; on the worker branch `b0a1b7c74..414be9000`), then the 0.1.474 bundles. Diff the repair alone with `git diff 08d01a3ba..df02a710c`. Scope, each as proven, plausible or unverified: (1) B1 is repaired: a busy lint store, at the open or in the read, is read again before the deadline and ends with its busy reason, exit 3, at the deadline's read; the two real-lock loop rows prove it. (2) A missing, unreadable or damaged lint store still ends `unread`, and no other lint outcome changed. (3) The worktree waits and the request loops did not change (the `settle` change keeps a field a read already gave: say whether any worktree row reads differently). (4) The notes' decision 6 limit: one attempt per lint read, where `withStatusStore` retries an immediate busy within its bound. (5) The `Date.now()` in `lintRead` for the busy text's waited ms, beside the clock port. The coordinator's tree passed lint, typecheck, `check:version`, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` (19 tests) at the candidate. Write `reviews/0.1.474-r2.md` and commit it on your branch.
