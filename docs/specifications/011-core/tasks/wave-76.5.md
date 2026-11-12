# Wave 76.5: repair R1 of row 011-319 (review 0.1.452)

Coordinator bef76bfb, 2026-11-12. Review `reviews/0.1.452.md` failed `cand/0.1.452` (`360021aa8`) on two proven blockers. Neither is a behaviour change: the reviewer proved that the keeper keeps the same files and the daemon decides as before. Both say the move is not finished. One repair, then a narrow re-review (`docs/process.md` step 6). Host policy and "not yours" as in `wave-76.md`.

## W1-R1: the repair

Use /worker. Shape: repair. Worker 65662af4, resumed on its own branch `cez/65662af4` (do not rebase it; the coordinator cherry-picks your commits onto the candidate). One commit per item.

Read: `reviews/0.1.452.md` (B1, B2, S1, check 5 items 2 and 4); your `tasks/011-319/notes.md`; `wave-76.md` W1.

1. **B1, one decision path.** The record's report and requeue are composed inline in `TierRecords.#write` (`record.ts`): the barrier's report, the startup failure a hold rejects, and the requeue set from first withholds, unfinished, held, not-started and interrupted files. Move that composition into the module as one function the daemon calls. The caller supplies its own facts: `Withholds.peek`'s split, the held files at this try, unfinished, not-started, interrupted, install moved. `Withholds`, its counting, the lock, the transaction and `recordTier` stay where they are. The table's daemon column calls that same function, then `runEnd` and `storeDecision` per file, as `recordTier` and `recordFile` do. `held` and `touched` become evidence reasons beside the final `StoreDecision`, not decision kinds. Add table rows for a first touch (requeue) and an exhausted one. `decideFiles` goes, or becomes that path; no second composition is left.
2. **B2, observed reads.** The snapshot and the change check over the observed reads move into the module. `observed.ts` calls neither `snapshotInputs` nor `changedSince`. A thin `prepareObserved` may stay so `test/scheduler/busy-withhold.test.ts` passes unchanged. No import cycle.
3. **S1.** Keep one CLI case that a kept result is read neither by the gate nor by a daemon once its observed read changed (from the deleted `code-gate-keep-observed.test.ts`), in `test/cli/code-gate-keep.test.ts`.
4. **Check 5, item 4.** Add a table row where only a revision during the run (`Tier.changes`, an ordinary listing change) makes a file unstable.
5. **Notes.** Update the mapping, and say plainly that the daemon's evidence entry re-keys environments (`rekeyEnvironments` whole; accepted).

Owns: as in `wave-76.md` W1, plus `test/cli/code-gate-keep.test.ts` for item 3.

Leave alone: as in `wave-76.md` W1. `store-decision.ts` byte for byte; `record-tier.ts` unchanged; no key-format raise. Stop and ask if any keep or store decision would change.

Done when: grep shows no `snapshotInputs`, `changedSince` or `barredByTouch` call outside the module, and no `prepareObserved` call outside it (a thin `prepareObserved` the module calls may stay in `observed.ts`, calling neither helper); `#write` takes its report and requeue from the module; the table's daemon column runs that function; the scheduler's and the keeper's tests pass unchanged; `test/keys/key-format.test.ts` and `test/keys/validity/` pass; lint and typecheck pass; `squeal status --wait 60000 <paths>`. Your final message lists each item's commit.

## R2: narrow re-review

Use /reviewer (codex gpt-6.1-sol high), pinned to the repaired candidate. Scope: B1, B2 and S1 of `reviews/0.1.452.md` and the repair delta only; the first review's proofs of keeper and daemon equivalence stand for the unchanged lines. Write `reviews/0.1.452-r2.md`.
