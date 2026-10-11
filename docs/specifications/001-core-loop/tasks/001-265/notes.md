# 001-265 notes: the moves vouch only for rows their writer wrote

Repair of `reviews/wave-13ac.md` B1 and N1.

## The choice

The brief offered two repairs: bind the sync answer to a daemon incarnation, or persist a token the new ledger writes that an older writer cannot satisfy. This repair is the token, kept per file.

The incarnation binding alone misses one succession: an older daemon moves keys, then a newer one replaces it and answers the sync. That is the plugin upgrade path. The answering daemon is unchanged for the whole wait, but its record lacks the older daemon's moves. A refined-revision token misses another: an older writer moves a key at a revision whose refinement it never advances (a content re-key, or same-revision growth).

So the record keeps, per test file, `[row revision, key digest]` as its writer last wrote the row (`Moves.keys`, `moves-keys.ts`; the digest is a sha256 prefix, 16 base64url characters). Every key change goes through `Ledger.commit`. `store-results.ts` and `releaseRunning` change only `pending`, which the check does not compare.

- **Reader** (`movesVouch`, and inside `answerMoves`): the record vouches only when every `test_file_keys` row matches its mark. The wait checks this before it builds the window (`answerMoves` returns `incomplete`). It checks again at every poll after the window is built, and on a mismatch it drops the window and takes the broad fallback for the rest of the wait. A record without `keys` (0.1.113, 0.1.114) vouches for nothing.
- **Writer** (`unrecordedRows`, `recordMoves`'s `rows`): a ledger's first commit reads the rows the record does not vouch for, before it writes any row. A pending one becomes a move open at its row's revision. Every one gets its mark. `dropped` is set to that commit's sequence, so a wait that started before it falls back. After that commit the record vouches again, so the fallback lasts only until the newer daemon's first commit.

The row revision is compared beside the key. An ABA move by another writer (K to K' to K at a later revision) changes the row's revision, so it is caught.

## Mixed versions

| Succession | Result |
| --- | --- |
| New answers the sync, old refines the capture (the review's case) | The row differs, so `incomplete` and the fallback. `status-wait-successor.test.ts`, red at 6864b726. |
| New's window is built, then old moves a key at a captured revision | The poll after drops the window and falls back. Same file, red at 6864b726. |
| Old moved keys, then new replaces it and answers | The new ledger's first commit takes the queued rows in as open moves. A wait from before falls back; a later one holds for them. `unrecorded-rows.test.ts`, red with the adoption removed. |
| 0.1.113/0.1.114 (moves without keys) before or after this | It drops `keys` when it rewrites the record, so the record vouches for nothing; the next new ledger takes every row in. |
| New after new | The marks match and nothing is taken in. No extra hold. |
| Old CLI against this daemon | Unchanged. It ignores `keys` and has no fix: its own B1 stays as it was. |

The wire, the schema (V1) and the sync answer are unchanged. `keys` is an additive field of the meta row.

## Costs and the edges left

- The record now holds a mark per test file, about 40 bytes each, rewritten with the row whenever it changes. A key change already rewrote it, since it records a move. A phase change at the same key and revision does not change a mark. Size on a large repository is still unmeasured, as research open question 2 already says.
- A newer daemon's first commit after an older one makes its waits hold for every row the older one left pending, backlog included, until each has a result. The broad fallback would hold for all of them anyway, so this only bounds the fallback to the waits that need it.
- Detection runs at a ledger's first commit only. Two daemons never run one worktree at once (the lock), and a successor's ledger is a new one. A long-lived ledger does not look again.
- `dropped` now also means "taken in". An older 0.1.114 CLI reading it falls back on waits from before the takeover, which is the safe direction.

## Seam map

- `src/core/scheduler/moves-keys.ts`: the marks (`readKeyMarks`, `marksVouch`, `markRows`).
- `src/core/scheduler/rekeyed-moves.ts`: `Moves.keys`, `unrecordedRows`, `movesVouch`; `recordMoves`'s optional `rows`.
- `src/core/scheduler/ledger.ts`: `#adopted`; `commit` reads `unrecordedRows` before its upsert and passes `{written: rows, unrecorded}`.
- `src/cli/status-wait.ts`: the per-poll `movesVouch` after the window.
- Test fixtures that write rows by hand must record them as the ledger does: `test/cli/status-wait-fixture.ts`'s `key()` does, and `rekeyed-moves.test.ts`'s `commit` passes the worktree's rows as written.
