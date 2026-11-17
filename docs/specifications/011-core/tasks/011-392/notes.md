# 011-392 notes: start-time store check leftovers

Worker notes for wave 27 W3 (brief `../../../005-agent-adoption/tasks/wave-27.md`). Baseline `cand/0.1.554`.

## Done in code

- (a) `markStore` left `src/core/store/mark.ts`. It is now a test fixture in `test/store/helpers.ts`: it writes a mark as it is, with no lock and no file check, as a writer before row 011-391 did. Its callers (`test/store/open.test.ts`, `test/daemon/store-fault.test.ts`, `test/daemon/open-recovery.test.ts`) import it from there. The comments in `src/core/daemon/full-check.ts` and `src/core/store/open.ts` name `markFault` (`src/core/daemon/store-fault.ts`).
- (b) `OpenStoreOptions.checkIntegrity?: IntegrityCheck` (`"mark"`) is now `recoverFaults?: boolean`. `IntegrityCheck` is gone. `recover` passes the caller's options to its re-check (the `?? "mark"` never applied) and opens the fresh store with `recoverFaults: false`. `test/daemon/open.test.ts` counts `storeOpens`; its title is "five concurrent starts open the store once: losers never open it". `test/daemon/mark-binding.test.ts` and `test/store/crash.test.ts` pass the new option too: a mechanical rename, outside the brief's list of test files but needed by the type change.
- (c) Comments in `src/core/daemon/open.ts`, `src/core/status/open.ts`, `src/core/types/store.ts` (now quotes D12 as amended) and `test/daemon/resumed-after-signal.test.ts` no longer describe a start-time check.

## Proposed spec wording (the coordinator lands it)

001 `spec.md`, D10 paragraph ("A hook that finds no live socket spawns..."), the sentence "The daemon takes `BEGIN EXCLUSIVE` ... before opening the store, so losers never run the integrity check, and holds it for life." Proposed, under the amendment convention, a line after the paragraph:

> Amended 2026-11-18 (row 011-392): no check runs at a daemon start (D12 as amended, row 011-391), so the lock before the store means a loser never opens the store.

011 `spec.md`, the same sentence in its paragraph ("... before opening the store, so losers never run the integrity check, and holds it for life."). Proposed amendment line:

> Amended 2026-11-18 (row 011-392): since row 011-391 no check runs at a daemon start; the lock before the store means a loser never opens the store.

If the coordinator prefers to edit the sentence in place: replace "so losers never run the integrity check" with "so a loser never opens the store".

## (d) A mark cut short: a behaviour change, not made

Today `readMark` (`src/core/store/mark.ts`) reads a mark file it cannot parse as `{ at: 0, problem: "the full integrity check failed" }` with no `found`. Every reader takes a missing `found` as the full check:

- `faultFound` (`src/core/daemon/store-file.ts`) → the daemon-stop note "daemon stopped: the full integrity check of the store found a fault (the full integrity check failed); ...".
- `foundBy` (`src/core/store/open.ts`) → the recovery note `{ found: "full-check", check: "full", checkedAt: 0 }`.
- `recoveryNote` (`src/core/status/snapshot.ts`) → "store was recovered from corruption ...: the full integrity check found a fault; ...".

Since row 011-391 a hook and a daemon also write marks, so a cut-short mark from either is reported as a full-check fault. A cut-short mark is rare: `markUnder` writes it with `wx` in one `writeFileSync`, so only a crash or a full disk mid-write leaves one.

Proposed change (touches `store-file.ts` and `status/snapshot.ts`, outside this row's brief, and changes user-visible text):

1. `readMark` returns `{ at: 0, problem: "the mark beside the store could not be read", unreadable: true }` (an additive optional `unreadable?: true` on `StoreMark`), or uses a new finder value `"unknown"` instead of a new field.
2. `faultFound` says "a fault was marked on the store (the mark beside the store could not be read)" for it.
3. `foundBy` writes `{ found: "unknown" }` with no `check`/`checkedAt`; `recoveryNote` maps `unknown` to "a mark whose finder could not be read", or to no "found by" clause.
4. A mark that parses, has `at` and `problem` and no `found` stays the full check's (marks from before 011-391).

Test (red first): write `"{\"at\":1,"` beside the store; `readStoreMark` returns a mark; `storeCondemned` text and the recovery note after `openStore(..., { recoverFaults: true })` contain neither "full integrity check" nor throw.
