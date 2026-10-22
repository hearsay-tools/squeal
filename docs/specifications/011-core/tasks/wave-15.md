# Wave 15 of spec 011

Three rows the human chose on 2026-10-22 ("Wave 15: 011-113, 011-112, 011-72"), from main with 0.1.265. Their seams are disjoint, so they run in parallel. 3b94ca98's rows 011-116 to 011-118 and 007-55 own no files yet; that session names them to the coordinator before it briefs any.

## W1: 011-113, a status read waits out its busy timeout

Use /worker. Shape: repair.

Outcome: `squeal status` and every status read wait up to their busy bound on a store a daemon is writing, and never give up after a few milliseconds.

Read board row 011-113, CI 39781190437's failed job (Node 22 2/3, `test/integration/pytest-environment.test.ts:105`), spec 011 C6 on status reads and C7 on the store.

Seam: `withStatusStore` and `readOnce` in `src/core/status/open.ts:69`, then `openStore` (`src/core/store/open.ts:70` and `switchToWal` at :86), `readTransaction` (`src/core/store/store.ts:34`), `isBusy` (`src/core/store/connection.ts:173`). A lead: a test that holds a write transaction, and at times a checkpoint, beside repeated status reads, and records which step returns SQLITE_BUSY at once (open, a pragma, the WAL switch, the transaction start, or close). SQLite skips its busy handler in some WAL cases.

Owns: `src/core/status/open.ts`, `src/core/store/open.ts`, `store.ts`, `connection.ts`, their tests, notes under `tasks/011-113/`. Not yours: `src/core/scheduler/` (W2, W3), `src/core/daemon-loop/` (W3), `src/core/types/store.ts` (W3), the board, spec text, bundles, version. No `npm run build`.

Done when: the test fails on the base and passes; the notes name the step that gave up; the daemon's own write paths keep their bounds; `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W2: 011-112, cut files never share a promoted file's next tier

Use /worker. Shape: slice.

Outcome: a tier that yields at its estimate + 30 s gives the promoted file a tier of its own, so the hold that 011-107 left for short or unknown durations goes, and #73's 0 s case is bounded.

Read board row 011-112 (its done-when includes review 0.1.265 S1), `tasks/011-107/notes.md` ("Residual"), `reviews/0.1.265.md` S1, spec 011 C4 step 5 and C15.

Seam: `joinSpan` in `src/core/scheduler/sharing.ts:29` and its call in tier selection (`src/core/scheduler/tiers.ts:265`), then `overruns` in `src/core/scheduler/yields.ts:267`. A lead: the 011-107 test "a tier of files with no known duration does not yield" turned around first.

Owns: `src/core/scheduler/sharing.ts`, tier selection in `tiers.ts` (not `recordTier`), `yields.ts`, `slots.ts` if its `SHARE_FLOOR_MS` use must follow, their tests, notes under `tasks/011-112/`. Not yours: `scheduler.ts` and `recordTier` (W3; ask first), the board, spec text, bundles, version. No `npm run build`.

Done when: the row's done-when tests pass, the hold and its test comment are gone, once-per-key and slot limits hold; `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W3: 011-72, validation holds while the index has unmerged paths

Use /worker. Shape: slice.

Outcome: a conflicted merge, rebase, cherry-pick or `stash pop` starts no tier and stores nothing at a key that names an unmerged path; `git add` or an abort ends the hold within 2 s.

Read board row 011-72, `tasks/011-61/design.md` sections 1 and 4 (R1), spec 011 C4 and C9 on the unresolved merge (amended 2026-10-21), and `research/probes/issue-68/`.

Seam: as R1 names it: `readHead` in `src/core/daemon-loop/head.ts`, a new `src/core/scheduler/hold.ts`, `#pump` and `#record` in `src/core/scheduler/scheduler.ts`, the lookups in `keying.ts` and `stored-keys.ts`, the sync pass in `src/core/daemon-loop/`, `WORKTREE_META_ROWS` in `src/core/types/store.ts`. A lead: R1's test 1 first.

Owns: those files and their tests, notes under `tasks/011-72/`. Not yours: `src/core/status/`, `src/core/delivery/`, `src/cli/` (011-73 and 011-74), `src/core/store/` but for the types (W1), `sharing.ts`, `yields.ts` and tier selection in `tiers.ts` (W2), the board, spec text, bundles, version. No `npm run build`.

Done when: R1's tests 1 to 10 pass; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.
