# 011-131: the record of an ended run leaves `scheduler.ts`

W1, worker ee7e4f44, from main c7e1d6a9c (0.1.277). Shape: slice (refactor). With 011-103 slice 1 and 011-132 slice 4.

## Answer

`src/core/scheduler/scheduler.ts` goes from 1,450 to 1,191 lines. The record path is one class, `TierRecords`, in `src/core/scheduler/record.ts` (342 lines). `scheduler.ts` has no `#prepare`, `#write`, `#heldNow` or `#barrier`. One rule decides when a pass is sliced: `#sliced`.

## Commits

1. 011-103 slice 1: `Ledger.endRunningAt(file, key)` ends a superseded tier's claim at `key` only. `#requeue` and `recordTier` call it.
2. 011-132 slice 4: `#handleBatch(batch, sliced: boolean)`. Its pass goes through `#sliced`, so it is sliced only when the scheduler has both `busySliceMs` and `busyWaits`. `handleBatch` passes `true`; `requestFullSuite`'s pass and `#reconcilePaths` pass `false`. The daemon and every test that sets `busySliceMs` also set `busyWaits`, so no behaviour changes.
3. 011-131: the move.
4. `test/scheduler/busy-fixture.ts`: `busyWrite` finds the record's write by the stack frame `TierRecords.#write`, not `TierScheduler.#write`. The one test edit beyond imports, approved by the coordinator (request fec0f4f0).

## The seam

- `TierRecords` takes a `RecordHost`: the lock, `started()`, `BusyResume`, the merge hold, `WarmUp`, `TierYields`, `InstallStamps`, the stop's signal, and callbacks for `#sliced`, `closed`, `stopping`, `reinstalled`, `runtimeMissing` and `SlowTier.ended`. The scheduler builds it at the end of its constructor, after `#slow` and `#busy`.
- `TierRecords` owns `Withholds`: only the record path used it. It also owns the `SlotRecords` whose `record` is its `#recordSlot`, and the `#slotsBusy`, `#prepared` and `#written` state.
- `#fly` calls `TierRecords.record(tier, ran, installStamp, slow, held)`. A slot releases its lease, marks the flight `ran` and notifies in `#fly`, before the call. `record` then calls `#ended` at once, as before. A slot's `held` is always `null` (`cancellable` needs `tier.slot !== true`).
- `#sliced`, `#runSliced`, `#requeue` and `#reconcilePaths` stay in the scheduler. The pump's selection and `#requeue` use them too.

## Decisions the brief did not settle

- The class is `TierRecords`, not `Record`: a class named `Record` hides TypeScript's global `Record<K, V>` type in its module. The name matches `TierYields` and `TierCapacity`.
- `Withholds` moved into `TierRecords` instead of being passed in, since nothing else in the scheduler read it.
- `record.ts` is 342 lines, above the styleguide's about 300: the about 270 lines of the record path, plus the host interface and the constructor. A split would cut one unit in two.

## For whoever continues

- A test that finds a record's write by its stack frame must match `TierRecords.#write`. Under Vitest a private method's frame reads `Class.#method`; plain Node prints only `#method`.
- `SchedulerOptions.busySliceMs` (`options.ts:93-97`, not this row's file) still says it is "the busy wait of each write of a `handleBatch` pass". Since slice 4 it applies only with `busyWaits`, as for the pump's writes.
