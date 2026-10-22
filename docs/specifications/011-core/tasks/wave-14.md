# Wave 14 of spec 011

Two approved rows whose dependencies shipped in 0.1.262 (011-66) and with 011-99 (done). Their seams are disjoint from each other and from W6 of wave 13 (`src/cli/start.ts`, row 011-110), so they run in parallel from main with 0.1.262.

## W1: 011-77, then 011-108, failure evidence that a retry or a crash does not erase

Use /worker. Shape: slice, one commit per row, 011-77 first.

Outcome: a failure a passing retry replaced stays visible in `failures` (marked `REPLACED`) and `why` (up to 5 older failures), and the run behind an UNKNOWN is recorded and named by `why`.

Read board rows 011-77 and 011-108, `tasks/011-64/design.md` section 3 (R3, tests 1 to 6) and section 4, `research/issue-74.md`, the digest's group C (`triage/2026-10-22-digest.md`), and spec 011 C5 to C7.

Seam: a new `src/core/store/repos/replaced.ts` and the read before `storeResults` in `src/core/scheduler/tiers.ts`, then prune, `src/core/status/failures.ts` and `src/core/status/format-why.ts`; for 011-108, `markUnknown` in `src/core/scheduler/ledger.ts:446` and the UNKNOWN known state (`src/core/types/state.ts`). A lead: R3's test 1 first.

Owns: those files, `src/core/store/` prune, the `why` and `failures` CLI and their `--json`, their tests, notes under `tasks/011-77/` and `tasks/011-108/`. Not yours: `src/core/scheduler/yields.ts` and `src/core/status/next-step.ts`, `standing-groups.ts` (W2), `src/cli/start.ts` (wave 13 W6), the board, spec text, bundles, version. No `npm run build`.

Done when: R3's tests 1 to 6 and the four tests of row 011-108 pass, across worktrees and a daemon restart; `test/keys/key-format.test.ts` passes, or the notes say which line it refuses and stop for the coordinator; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W2: 011-107 with 011-103 slice 6, a tier past its estimate yields

Use /worker. Shape: slice, two commits, slice 6 first.

Outcome: a promoted named wait waits at most a running tier's estimate plus 30 s, also when the estimate is 0 s or stale and short.

Read board rows 011-107 and 011-103 (slice 6), `quality/2026-10.md` slice 6, `research/issue-73.md`, the digest's group B, and spec 011 C4 step 5.

Seam: `#decide` and `remainder` in `src/core/scheduler/yields.ts:114` and `:207`, then one standing kind and its text in `src/core/status/next-step.ts:67` and `src/core/status/standing-groups.ts:40`. A lead: slice 6's one `remainderSeconds` and the "30 s" from `YIELD_REMAINDER_MS` first, then the 0 s estimate test.

Owns: `src/core/scheduler/yields.ts`, `src/core/status/next-step.ts`, `src/core/status/standing-groups.ts`, `test/scheduler/tier-yields.test.ts` and new tests beside it, notes under `tasks/011-107/`. Not yours: how the estimate is taken (`ledger.ts`, `files.ts`, `edit-cut.ts`), W1's files, the board, spec text, bundles, version. No `npm run build`.

Done when: both rows' done-when hold (the 0 s and stale-short estimates yield within the bound, within-estimate tiers keep today's rule, no second yield at a key; slice 6's −0.6 s and 0 s files in one group); `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary. Draft the C4 sentence in the notes.

## R1: review of wave 14's candidate

Use /reviewer. Shape: review. Pinned to the `cand/<version>` SHA named in the spawn, on main after 0.1.263 and 0.1.264; the range is `origin/main..<sha>`: W1's three commits from `c04a258b/w14-w1` (011-77 twice, 011-108), W2's four from `c04a258b/w14-w2` (011-103 slice 6, the 011-107 rule, the `scheduler.ts` edit by coordinator agreement, and a fix), one docs commit (011 C4, C6, C7, C15 and `status.md`) and the release commit (version, bundles).

Read W1 and W2 above, the notes under `tasks/011-77/`, `tasks/011-108/` and `tasks/011-107/`, board rows 011-77, 011-108, 011-107, 011-103 and 011-112, `011-64/design.md` sections 3 to 5, and the amended spec sentences. Check that:
- 011-77: a failure that a passing retry, re-run or another worktree's run replaced stays in `failures` and `why` with its run, log and load, across a daemon restart and the first prune; caps and the 7-day expiry hold; older stored failures below the newest 20 show in `why`;
- 011-108: `why` names the run behind an UNKNOWN, its worktree, revision and log, also when every stored result passes; a missing log names one reason; prune keeps that run while the UNKNOWN stands; no key input moves;
- 011-107: a tier 30 s past its estimate yields to a promoted wait with no other event, the promoted file runs alone, and the hold under `SHARE_FLOOR_MS` (unknown durations count 0) keeps such a tier running; at most one unref'd timer, cleared when its tier ends and on close; the `scheduler.ts` edit is only the re-check;
- slice 6: one `remainderSeconds` serves a yield's line and its group;
- two choices the coordinator accepted, to judge: every `failures` entry prints an `at` line, also when the fingerprint line already ends with that location (011-77 notes, decision 1); the flaky note's `the FAIL it replaced` line is left out when the replaced failure at its key is listed (one 011-19 assertion changed);
- `--json` of `failures` and `why` grows additively; `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged; the version is raised in all eight places; the bundles match the tree; the four launchers are byte-identical.

Run `npm ci`, then the test files W1 and W2 added or changed, directly. The full suite is CI on the candidate and the coordinator's locked gate (`.ai/cezar/t/04a258b0/logs/gate-w14.log`); read both by test name. Rows 011-111 and the run-cell S2 teardown test are known flakes. Write `reviews/<version>.md` with a PASS or FAIL verdict and commit it alone.

## Wave 14.5: repair of review 0.1.265

Both start from `ffa124533` (cand/0.1.265 f9fb6c219 plus `reviews/0.1.265.md`). Their seams are disjoint; they run in parallel.

### W3: B1 and B2, replaced failures in order and reachable from `why`

Use /worker. Shape: repair, one commit per blocker, B1 first.

Outcome: `--per-check` and `why` order replaced failures by when they failed, and `why` finds a kept failure whose check has no state or result left in this worktree.

Read `reviews/0.1.265.md` B1, B2 and "Inputs for the fix wave", W1 above, `tasks/011-77/notes.md`, spec 011 C6 and C7.

Seam: B1 at `selectReplaced` (`src/core/status/replaced-failures.ts:95`) and `replacedOf` (`src/core/status/why.ts:264`); B2 at `why.ts:258` and its check guards at lines 76 to 95. A lead: the review's two probes as failing tests first, B1 with a stored failure between the two kept ones.

Owns: `src/core/status/replaced-failures.ts`, `why.ts`, `failures.ts`, `format-why.ts`, `format-why-replaced.ts`, `test/cli/failures-replaced.test.ts`, `test/status/why-older-failures.test.ts`, new tests beside them, `tasks/011-77/notes.md`. Not yours: `src/core/store/` (W4), `why-unknown.ts` (W4), keyed results and their storage, the board, spec text, bundles, version. No `npm run build`.

Done when: both probes' tests fail on the baseline and pass; a stable tie rule is tested; exact and partial `why` lookups find the kept failure with its log and stack after its worktree's prune; the existing failures and `why` tests and `test/keys/key-format.test.ts` pass; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

### W4: B3, a standing UNKNOWN keeps its run record

Use /worker. Shape: repair.

Outcome: no bound evicts the record of an UNKNOWN that still stands, so `why` names its run and prune keeps that run until the state changes.

Read `reviews/0.1.265.md` B3 and "Inputs for the fix wave", W1 above, `tasks/011-108/notes.md`, spec 011 C6 and C7 (the 011-108 sentences).

Seam: `recordUnknownRuns` in `src/core/store/repos/unknown-runs.ts:57`, then `src/core/status/why-unknown.ts:47` and `src/core/store/prune.ts:108`. A lead: drop fallen records before any bound applies; the review's probe as a failing test first.

Owns: `src/core/store/repos/unknown-runs.ts`, `src/core/status/why-unknown.ts`, `src/core/store/prune.ts`, `test/scheduler/unknown-run.test.ts`, `test/status/why-unknown-run.test.ts`, new tests beside them, `tasks/011-108/notes.md`. Not yours: `why.ts`, `failures.ts`, `replaced-failures.ts` (W3), `ledger.ts` (ask first), the board, spec text, bundles, version. No `npm run build`.

Done when: the probe's test fails on the baseline and passes; more than 1,024 records across worktrees, and many recovered records followed by one new UNKNOWN, keep every standing one through a prune past retention; a record this release wrote never reads `older-daemon`; `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

### R2: narrow re-review of the repaired wave 14 candidate

Use /reviewer. Shape: review, narrow, the last round. R1 failed cand/0.1.265 at f9fb6c219 (`reviews/0.1.265.md`, B1 to B3). The coordinator re-cuts it with W3's and W4's commits and one release commit, pinned to the SHA named in the spawn.

Check only: `git range-diff` shows wave 14's nine commits unchanged but for their cherry-pick lines; B1 to B3 hold as the review's expected behaviour says, by W3's and W4's tests and your own probes; no keyed result, key format, validity, delivery or schema change; the version and the bundles as in R1. Run `npm ci`, then the files W3 and W4 changed or added, directly. The full suite is CI on the candidate and the coordinator's locked gate; read both by test name. Write `reviews/<version>-r2.md` with a PASS or FAIL verdict and commit it alone.
