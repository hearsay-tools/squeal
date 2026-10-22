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
