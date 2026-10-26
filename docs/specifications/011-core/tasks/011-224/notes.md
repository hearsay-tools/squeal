# 011-224 notes: the request history writes the fact of each request it drops

Worker f349cb4a, wave 44 W1, 2026-10-26. The rule below was agreed with the coordinator in request 0eebfc75 (reply: option A; it narrows the gap the human accepted for 0.1.325, decision card c63f05ef, so it needs no new decision).

## What changed

- `writeRetries` (`src/core/retry/records.ts`) is the one owner of the one-run fact. In its caller's transaction, before the trim, it writes the `retries-asked` fact of every request in the row it is given, dropped and kept, whoever stored it, in one batch (`addAskedKeys`, `src/core/retry/kept.ts`). Every write of the `retries` row goes through it: `askRetry`, `askNoResultRun`, `askNamedRun` when it stores, `claimRetries`, `releaseRetries`, `endRetries` and `cancelRetries` (`endWhere`), and `markGateClosed` (`gate.ts`). The old per-request `addAskedKey` is gone; the new request is one of the records `writeRetries` gets.
- `askNamedRun` writes the facts of the requests it finds at its key, before it answers `joined` or `asked`. So a request the wait found keeps its fact when a released writer trims it later.
- `addAskedKeys` reads the ledger once and writes it only when a fact is new, or newer than the kept one. A fact that has lapsed (more than 7 days before the newest request given, at a key no worktree's row holds) is not written back. So a request that stays in the row after its fact lapsed does not rewrite the ledger at each write.
- The 7-day clock is the newest `askedAt` of the records given. `writeRetries` has no clock of its own: `gate.ts` calls it without one. Before, it was the new request's `askedAt`, so a write that adds a request prunes as before. A claim or end write prunes at the newest request's time, which is never later than the real time, so it keeps facts longer, never shorter.
- The ledger stays oldest first: after a merge it is sorted by `askedAt` (stable). The 4,096 cap and its order (lapsed first, then the oldest) are unchanged.
- No new column, table, `meta` key or `user_version` (011 C7). The `retries` and `retries-asked` row shapes are unchanged. No type change: `addAskedKey` (not exported from `index.ts`) became `addAskedKeys`.

## The rule for a request an older Squeal stores and drops

An older Squeal is 0.1.323 or earlier, which writes no fact, or 0.1.325 to 0.1.329, whose trims and claim and end writes do not write the fact of a request they did not store. A request it stores gets its fact when a newer Squeal next writes the `retries` row, or when a named wait finds it at its key. One that an older Squeal stores and drops before that has no fact. This includes a request trimmed before the upgrade. An older Squeal drops a request only after 1,024 later ones.

Then a named wait can ask one more run of that file at the same key. That request records the fact, so it happens at most once per file and key.

User-visible: yes, rarely. The wait prints "Run asked: <file> ..." and the file runs once more at the same inputs. It needs an older Squeal that makes 1,024 more requests after that one with no newer Squeal writing the row between them.

Rejected (option B): keep the id of the newest request seen and turn the ask off for 7 days when it is gone. To cover requests trimmed before the upgrade, it must treat a full row at first sight as a gap. That turns named-wait asks off for 7 days after the upgrade in any store with long history.

## Proposed C15 text (for the coordinator)

It replaces the sentence "Amended 2026-10-25 (the human, after review 0.1.322-r2): a known limit. ...":

> Amended 2026-10-26 (row 011-224, narrowing the human's 2026-10-25 known limit): every write of the `retries` row first keeps the fact of each request in it, dropped or kept, whoever stored it, and a named wait keeps the facts of the requests it finds at its key. A request stored by an older Squeal gets its fact when a newer Squeal next writes the `retries` row, or a named wait finds it at its key. One that an older Squeal stores and drops before that, before the upgrade included, has no fact: a named wait can ask one more run of that file at the same key. That request records the fact, so it happens at most once per file and key.

The `status.md` line of 2026-10-25 names the same limit and can point to this amendment.

## Tests

- `test/retry/released-0.1.323.ts`: the released writer, copied from `squeal--v0.1.323:src/core/retry/records.ts` (`askRetry`, `askNoResultRun`, `cancelRetries`, `endRetries` and its trim `records.slice(-RETRIES_KEPT)`). `readRetries` and `retriesAt` are unchanged since, so it imports them.
- `test/retry/legacy-asked.test.ts`, the coordinator's contract (2):
  - (a) ended and cancelled requests stored by the released writer, no ledger row, then dropped by the candidate's trim: a named wait answers `asked` and stores nothing.
  - (b) the same after one candidate write, then dropped by the released trim.
  - The re-review's probe order (held key, released request ended `unknown`, `askNamedRun` answers `asked`, the row filled to 1,024, one more request at another key), with the candidate trim and with the released trim.
  - (c) the accepted limit: stored and dropped by older Squeals before any new write. The first named wait asks one run; after that request ends and older Squeals drop it, a second wait answers `asked`.
  - Batching: one `writeRetries` of a full legacy row writes the ledger once, with 1,024 facts; a later write with no new fact does not write it.
- Red first: before the fix, the six (a), (b) and re-review cases answered `queued` (`expected 'queued' to be 'asked'`), and the batching case wrote the ledger 0 times. (c) passes before and after: it pins the accepted limit.

## For the next worker

- Read-only exits do not write facts: `askRetry`'s `spent`, `askNoResultRun`'s `joined`, a claim, release or end that changes nothing, and `askableFiles` (`src/cli/status-wait-ask.ts`), which reads the store only. A request they see keeps its fact only once some newer Squeal writes the row. This is inside the rule above.
- Cost: each row write now parses the ledger once (at most 4,096 entries). `heldIn` lookups happen only for new facts older than 7 days and in the prune, as before.
- Squeal lists the fixture's `spends` and `askRetry`'s spent filter as code no in-process test reaches. The copy keeps them for fidelity to the released writer.
