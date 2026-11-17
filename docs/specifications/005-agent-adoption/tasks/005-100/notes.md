# 005-100 notes: a registration in a running session keeps the own count

Worker 71f2262a, 2026-11-17. Wave 19, W1 second part. The human: option A on the eval flag.

## Cause

Two kinds of registration happen in a running session:

- **Still registered** (a SessionStart `resume` after a missed SessionEnd, a boundary or prompt that says a registration still owed, row 005-98): `registerNow` skips the first-registration records, so `since` was already kept. Tested now.
- **Parked** (under Codex each turn ends with SessionEnd, which unregisters and parks the consumer; Claude Code under Squawk the same): the next SessionStart `resume` takes the parked registration up (`tellRegistered`), and `startEdits` wrote `since` = the registration's revision. The edit state (`edits:` row) had been dropped at the unregistration (`forgetEdits`); only `said` was parked. This is the eval's case: the failure delivery after the resume read "Revision 1 (changed src/invoice.ts)." with no count.

## As built

- `park` (`src/core/delivery/registered.ts`) keeps `editsSince`, the revision the consumer's own count counted from, beside `said` and `uncovered`; `drop` (`expiry.ts`) passes it from `editsToPark` (`edits.ts`, which replaces `editsSaid`).
- A registration that takes a parked registration up starts its edit state at that `editsSince` (`seedRegistered` in `delivery.ts`); a parked registration from before this version has none and starts at the registration's revision.
- A first registration, a new session (another session id) and a parked registration past its lifetime (`CONSUMER_EXPIRY_MS`) start at the registration's revision, as before.
- The re-key record (`rekeyed.`) is pruned of resolved entries only below every registered consumer's `since` and every parked registration's `editsSince` (`parkedEditsSinces`), so a resumed count still finds the files resolved while it was away. An expired parked registration stops holding entries once `writeParked` drops it.

Files outside the brief's list, for the coordinator: `src/core/delivery/registered.ts` (`Parked.editsSince`, `Resumed.editsSince`, `parkedEditsSinces`) and `src/core/delivery/expiry.ts` (one call). The parked registration lives there; there was no other place that outlives the unregistration.

Type changes, all additive except one: `Resumed.editsSince` (required: every caller is in `src/core/delivery`); `Parked.editsSince` (optional). `editsSaid` is renamed `editsToPark`.

## A compaction

A `compact` SessionStart of a main agent still registered does not register: the count goes on. A `compact` of a consumer that is not registered registers it; when it was parked within the lifetime, the count goes on from the parked `editsSince`. Reason: the count is of the session's edits, which a compaction does not undo; only the primer is restated, because the context lost it.

## Known limit

The count reads every file the re-key record shows re-keyed after `since`; while the consumer was parked, another session's edits can re-key files too, and they are counted as "your edits affect". This was already so for a registered consumer beside another session (row 005-92 named the shared line "files changed here since this session started"). The gap of the parked time (`Registration.gaps`) is used only to decide whether anything changed.

## Late state (005-97)

Unchanged: leaving forgets the late state, so a resumed session owes no caught up (`late-paths.test.ts` "a session that leaves", `late-cells.test.ts` "an expired consumer"). A file of an edit from before the park that is still owed after the resume counts as owed, and can make a later boundary say "late" once it passes the bound. That is the edit's own file, so it is the right message.

## Path-table rows (registration)

`tasks/005-97/notes.md`, the row "Registration, leaving, expiry", `since` column, becomes:

| Path | Late / caught up | A delivered new failure | Other news while late is open | `since` |
| --- | --- | --- | --- | --- |
| Registration, leaving, expiry | never at registration; an edit before a first registration is never late (C "a registration counts from its revision") | — | leaving forgets late (P "a session that leaves"); expiry too (C "an expired consumer") | a first registration, a new session, or a parked registration past its lifetime: the registration revision; a consumer still registered: kept (R "while still registered"); a parked one taken up: its parked `since` (R "through park and resume", "through a waiterless expiry") |

R: `test/delivery/edits-registered-again.test.ts`.

`tasks/005-93/part1-notes.md` has no registration row.

## Tests

`test/delivery/edits-registered-again.test.ts`: register, edit, register again, failure delivery with the count; the same through unregister and resume and through a waiterless expiry; files resolved while parked stay in the count (fails without `parkedEditsSinces`, checked by removing it); a parked registration past its lifetime, a new session and a first registration count from their registration. `test/delivery/edits.test.ts`: the prune test now keeps an entry for a parked consumer, and a new test drops it once no count reads it.
