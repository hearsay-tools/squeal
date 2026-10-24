# 015-17 notes: repair of review 0.1.283, B2 and B5

Worker 15f7d48e, 2026-10-24, from `cand/0.1.283` at de9deb5bc. The sibling row 015-16 repairs B1, B3 and B4 on other files.

## Seam map

| What | Where |
|---|---|
| B2: the move takes the transitions with it | `move` in `src/core/code/store/states.ts`; its contract in `CodeStateRepo.move`, `src/core/code/store/types.ts` |
| B5: old body hashes by the kept state's blob | `oldBodies` in `src/core/code/pass/pass.ts` |
| Readers of the last transition | `lastTransition` (`src/core/delivery/code-deliver.ts`): `planCodeDelta`, `wentOverSince` and `changedSince` (`code-since.ts`), so Stop, status and `squeal code --changed` |
| Prune keeps a count a kept state names | the counts delete in `pruneCodeStore`, `src/core/code/store/prune.ts` (coordinator agreement, 015-17) |
| The test rig: a pass over a fake counter, read by the delivery as a hook reads it | `test/code/pass/rig.ts` |

## What changed

- **B2.** `states.move` now re-points the old check's `transitions` rows to the new check id in its one transaction, beside `states` and `views`. Each row keeps its revision and time. No transition is recorded. Before the re-point it deletes the transitions the new identity held: they belong to an earlier function at that identity, as its stale state and view rows that `UPDATE OR REPLACE` already drops. Without that delete, an older `removed` row of the new identity could have a higher id than the moved crossing and so read as the last transition.
- **B5.** `oldBodies` reads the work set's complexity states and loads the count of each state's own `blob`, with the path's language from its files row and the counter version the states were judged by (an edit pass runs only at the cursor's version). The files row stays what it was: pending progress, which status counts as `counting`. `blobs.ts` needed no change: a skipped or failed path already keeps its state, and that state's blob is the provenance.

## Decisions the brief did not settle

1. **The new identity's earlier transitions are dropped at a move**, not merged. Merged, `findLast` by id would mix two functions' histories.
2. **Cost of B5.** One more read of the work set's states per edit pass, outside the write transaction: 1.2 ms for one path and 8.7 ms for 300 paths over 7,500 states, at load 8.6.
3. **Prune keeps a count while a states row names its blob** (the coordinator's decision, 2026-10-24). After B5 a kept state can name another blob than its files row while that row's count is pending (S1), and the old rule kept a count only while a files row named it. The clause is a non-correlated `counts.blob NOT IN (SELECT s.blob FROM states s)`, with no index on `states.blob`: 1.4 s against 0.4 s for 20,000 old counts beside 75,000 states (10 worktrees), in batches of about 17 ms, at load 20. A correlated `NOT EXISTS` took 108 s on the same store.

## For the next rows

- **Prune** still has no caller. The row that gives it one inherits decision 3.
- **S1 (row 015-18).** A path whose count failed stays pending until a revision changes it again. With B5 its kept state keeps the right provenance in that time.
