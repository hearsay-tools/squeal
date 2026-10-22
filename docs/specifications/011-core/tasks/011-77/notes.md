# 011-77: a failure a retry replaced stays kept, and `why` keeps older failures visible, worker notes (2026-10-22)

Brief W1 of `../wave-14.md`, first commit. Base main at `1bbe7e43f` (0.1.262). Design `../011-64/design.md` section 3, section 4 consequence 3, and section 5 (R3); spec 011 C5, C6 and C7 as amended 2026-10-21 for 011-64.

## Seam map

- `src/core/store/repos/replaced.ts` (new): the shared `meta` entry `replaced-failures`, a JSON array, oldest first. `failingAt(conn, key)` reads the failing rows at a key with their `failure_id` through `results_by_key`. `keepReplaced` keeps each failing row that a pass in the new records replaced at its key, with the load per CPU of its run. `capped` drops an earlier entry of the same check, key and failing run, then keeps the newest 4 per check and the newest 1,024 in all. `expireReplaced(conn, cutoff)` drops entries whose failure is older than the cutoff. `keptByReplaced(conn)` gives the run ids and failure text ids prune keeps. An entry that does not parse is left out; a row that does not parse reads as empty.
- `src/core/store/repos/failures.ts`: `store.failures` gains `failingAt`, `keepReplaced`, `replaced` and `text(failureId)`.
- `src/core/scheduler/tiers.ts`: in `recordTier`, inside the tier's transaction, `failingAt(storeKey)` before `storeResults`, then `keepReplaced` after `recordFailedLoad`. The load per CPU is read lazily from `failed-run-loads` only for a row a pass replaced. `storeResults` and `store-results.ts` are unchanged.
- `src/core/store/prune.ts`: expired entries go first, in their own transaction, so an expired entry's run, log and text go in the same pass. `dropOrphanFailureTexts` keeps the texts kept entries name, and the runs `DELETE` keeps their runs, including a run whose worktree is gone. Both read the entry inside their own write transaction, so an entry a daemon writes meanwhile is never missed.
- `src/core/status/replaced-failures.ts` (new): `selectReplaced` applies `failures`' selection (worktree, `--since`, paths, `--check` texts against `formatCheck`, `--error` against the summary, `--per-check`) to the kept entries in memory. `mergeFailures` merges them with the SQL-limited stored rows, newest first, cut at `--limit`. `perCheckTotals` counts the checks with `--per-check`, with one extra query only when replaced failures are selected.
- `src/core/status/failures.ts`: the merge; `replaced` in the report; each failure prints `at <location>[, called from <frame>]`; a replaced one prints `REPLACED` and `replaced by PASS <time> (<worktree>, run <id>), load <n> per CPU when it ran`.
- `src/core/status/why.ts`: `olderFailures` (up to `WHY_OLDER_FAILURE_LIMIT`, 5, stored failures after the newest 20 results) and `replacedFailures` (the check's entries, newest first, each with its run's `logDir` and its text's errors, `null` for what was pruned).
- `src/core/status/format-why-replaced.ts` (new): the `Replaced failures (N, newest first)` block, `errorLines` and `worktreeName`, moved out of `format-why.ts` to share them. `format-why.ts` prints `Older failures still stored (N, newest first)` after the results, then the replaced block, and leaves out the flaky note's `the FAIL it replaced` sub-line when an entry at the note's key is listed.

## Type changes (all additive)

- `src/core/types/store-records.ts`: `FailingRow`, `FailureText`, `ReplacingPass`, `ReplacedFailure`.
- `src/core/types/store.ts`: `FailureRepo.failingAt`, `keepReplaced`, `replaced`, `text`.
- `src/core/types/status.ts`: `FailureEntry.location`, `testFileFrame?`, `loadPerCpu`, `replacedBy?`; `FailureReplacedBy`; `FailuresReport.replaced`; `WhyReport.olderFailures?` and `replacedFailures?`; `WhyReplacedFailure`. `--json` of `failures` and `why` grows with no `schemaVersion` raise (011-51's precedent).

## Tests (R3's 1 to 6)

1. `test/scheduler/replaced-failures.test.ts`, first case: the issue-54 probe through the product scheduler (3.33 load per CPU, then a passing `load` retry at the same key). Red before (`total` 0). Second case, across worktrees: A's fail, B's pass at A's key; both worktrees' `failures --all-worktrees` and `why` keep A's failure.
2. `test/store/replaced.test.ts`: flips at k1, k2, k1, k1 all kept in order; a 5th of the check drops its oldest; the 1,025th drops the oldest of all. A fail, a skip, or a pass at another key keeps nothing.
3. `test/store/replaced.test.ts`: prune 1 h later keeps text, run and log; prune 8 days later drops the entry, then them. Under the size cap the text stays, and a run whose worktree is gone stays. `test/status/why-older-failures.test.ts`: an older release's prune (the text at its next pass, the run at the cutoff) reads `failure text pruned` and `log: run record pruned`, with no stale path.
4. `test/status/why-older-failures.test.ts`: 2 stored fails below 22 newer passes are listed under `Older failures still stored`. Red before. At most 5.
5. The existing known-state, `Known failures`, `FAIL -> PASS` delivery, flaky-note and checkpoint tests are unchanged and pass. Changed only: `test/cli/failures.test.ts`, the new `at` line and `--json` fields; and one `why` assertion in `test/scheduler/rerun-slow-teardown.test.ts` (011-19), which read the flaky note's `the FAIL it replaced` sub-line that the design now leaves out when the replaced failure at the note's key is listed. The first error is still printed once, in `Replaced failures`.
6. `test/keys/key-format.test.ts` passes at revision 30, the alarm silent: the new code is off every entry's path.

Also `test/cli/failures-replaced.test.ts`: the merge, the marks, the selection, `--limit` and `--per-check` with replaced failures. The write-lock check (design "most likely false", second): 8 flips in one commit at 1,024 kept entries, bounded at 2 s.

## Decisions the spec did not settle

1. Every failure in `failures` prints `at <location>[, called from <frame>]` on its own line, a stored one too (C6: "Each failure names its location and its test-file frame"). The fingerprint line also ends with the error's location, so the line repeats it for most failures; the alternative, printing it only with a frame, makes the rule depend on the fingerprint's cap.
2. `--per-check` merges replaced failures as well: each check once at its newest selected failure, stored or replaced. `replaced` then counts the checks whose newest is a replaced one.
3. A failing row is kept only when the new record at the same check and key is a `pass`. A `skip` replacing a fail is not kept (the design names a pass only).
4. A kept entry keeps its run even when the failing worktree is gone from the store (C7 as amended: kept until the cutoff). The bound is the 1,024 entries.
5. `why` prints the replaced failure's summary and every error of its kept text, as a stored result's lines do, and `failure text pruned: its errors and stack are gone` when the text is gone.

## Residue

- `format-why.ts` stays at about 350 lines; the new blocks went to `format-why-replaced.ts`.
- Each flip rewrites the whole `meta` row (up to about 1 MB). A tier whose files flip at one key rewrites it once per file. A later row could batch the tier's entries into one write.
