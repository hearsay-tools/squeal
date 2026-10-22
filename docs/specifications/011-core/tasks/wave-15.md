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

## R1: review of cand/0.1.266

Use /reviewer. Shape: review. Pinned to the `cand/0.1.266` SHA named in the spawn; the range is `origin/main..<sha>`: W1's three commits (011-113, one by agreement in `src/core/delivery/attribution.ts`), W3's three (011-72), W2's two (011-112, one by agreement in `scheduler.ts`), one docs commit (011 C4, C6, C15 and `status.md`) and the release commit (0.1.266, bundles).

Read W1 to W3 above, the notes under `tasks/011-113/`, `tasks/011-72/` and `tasks/011-112/`, board rows 011-113, 011-72 and 011-112, `tasks/011-61/design.md` sections 1 and 4, `reviews/0.1.265.md` S1, and the amended spec sentences. Check that:
- 011-113: no status, `failures` or `why` read writes; a read SQLite answers busy at once is retried in a new transaction within its bound; no other read path still writes; the daemon's write paths keep their bounds;
- 011-72: R1's tests 1 to 10 hold, the race stores nothing and no `unknown` follows a withhold; judge the store view in `hold.ts` that hides results at held keys during the known-state refresh, against an explicit parameter off the validity path, and the gate's place in `Ledger.settle`;
- 011-112: a tier that yields past its estimate gives the promoted or edited file a tier without the cut files, for unknown, sub-second and 2 s / 5 s durations; remainder cuts still share (row 011-51's case 2); once-per-key and slot limits hold;
- `#pump` holds both W3's gate and W2's argument;
- `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged; the version is 0.1.266 in all eight places; the bundles match the tree; the four launchers are byte-identical.

Run `npm ci`, then the test files W1 to W3 added or changed, directly. The full suite is CI on the candidate and the coordinator's locked gate (`.ai/cezar/t/04a258b0/logs/gate-w15.log`); a gate log names only failing files. Rows 011-111 and 006-95 are known flakes. Write `reviews/0.1.266.md` with a PASS or FAIL verdict and commit it alone.
