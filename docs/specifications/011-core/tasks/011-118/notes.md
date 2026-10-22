# 011-118 notes: a checkpoint counts a file made current by a lookup as done

Worker f443efd5, 2026-10-22. Brief: `tasks/toolkit-latency.md`, section 011-118. Sources: `research/edit-latency.md` 1 and 3 (E8, open question on revisions 69 and 73); 011 C4 Explicit checkpoints; spec 001 D7 as `checkpoints.ts` quotes it ("completes when every requested test file got a result, from a run or a lookup, at any key").

## 1. E8: the defect and the fix

`Ledger.settle` has two lookup paths. A key with stored results takes them through `applyResults`, which calls `checkpoints.done`. A key that is the file's own `resultKey` again takes the short branch: discharge, dequeue, sync the phase, `continue`. That branch made the file current and never told the open checkpoint. E8 takes that branch: the swap file moves the key away, `run --all` requests the file, and the swap file's removal moves the key back to the one its results stand under. Nothing is queued or runs, so nothing else ever calls `done`, and the checkpoint stays open until the daemon stops.

Fix (`src/core/scheduler/ledger.ts`, one call in that branch): when the file is `current` after the branch (`classify`), `checkpoints.done(ref, null)`. Choices the spec did not settle:

- `by` is `null`. A forced `run --all` is strict and counts only its own tiers (001-217). An old result at the old key is no run of the forced checkpoint, so a strict file does not count here.
- `classify(file) === "current"` leaves out the branch's other cases. A key the tier in flight runs is `running`, and that tier's result calls `done`. A key at which the file is `unknown` is not done. Under wave 15's merge hold (row 011-72, 0.1.266) a held key never enters the branch through `resultKey`, so a held file is never counted. The branch rebased onto main at `0cb635de4` (0.1.266) without a conflict.

Regression: `test/scheduler/checkpoint-lookup.test.ts`, E8 over a real Vitest run with observed inputs. The swap file's run is held at the gate. Without the fix it fails at `expected null to be 'completed'` right after the removal's batch.

## 2. Revisions 69 and 73: a different defect, in `tiers.ts`

The live file stayed pending after the lookups at revisions 69 and 73 for another reason: **a cancelled re-run is queued again forced at the key the revision moved it to, and a forced entry skips every later lookup.** The E8 fix does not reach it, because `settle` returns at `isForced` before the result-key branch.

Mechanism (read in source, then reproduced):

1. Edit 1 fails, so its re-run is queued forced (task 001-171) and starts (live `2202a931`).
2. Vim opens (live revision 67). `settle` moves the key to the swap key. `rerunPending` and a new key end the re-run (`endRerun`, review wave 13i S1). The file is running, so `queue.remove` removes nothing, and it is queued at the new key as a normal miss. The revision cancels the tier.
3. The cancel ends after the runner's grace (live 13:22:49.760, 1.2 s after revision 67). `recordTier`'s `requeue` decision calls `ledger.enqueue(file, priority, forced, ...)` with the tier entry's `forced`, which is still `true`. The file is now queued forced, at a key that is not the re-run's.
4. Revert 1 (live revision 69) moves the key to the stored PASS key. `settle` sees `queue.isForced` and `continue`s before its lookup. The row is written at the new key with phase `queued`. The sink's refresh reads the stored PASS there, so FAIL -> PASS is delivered in 57 ms, but the file stays queued. `run --all` lists it (checkpoint `a6b8463a`). The forced run `245cf8c4` starts, and the next vim open cancels it. Step 3 queues it forced again, and revisions 73 and 76 repeat step 4.
5. Only run `a55e8896`, which no revision cancelled, stores a result, at 13:27:06.660. Both checkpoints complete then. The `rekeyed-moves` row stays open from revision 67 to 78 because `settle` never reaches `#discharge` for a forced entry.

Every live observation in `research/edit-latency.md` section 1 fits this: a fast transition with a pending file, each `run --all` listing it, every run forced and so without a lookup. So the live checkpoint `a6b8463a` (13:23:01 to 13:27:06) was held open by this defect, not by E8's.

Reproduced on this tree with a throwaway harness probe (the E8 setup, then a test that fails on `tree/broken`). The gate held the re-run while the swap file's batch settled, then released it. Temporary log lines in `settle` and `recordTier` printed:

```
PROBE requeue test/lists.test.ts forced true ran e7662b now b2b545 cancelled true
PROBE forced skip test/lists.test.ts 5090c9 rerun false result e7662b
after revert true row queued started 2
header {"current":13,"pending":0,"stale":0,"unknown":0}
run --all lists [ 'test/lists.test.ts' ]
```

The key after the revert is the stored PASS key (`5090c9`, `true`). The checks read current, but the row is `queued` and `run --all` requests the file. The probe and the log lines are not committed. The clone's E7 ended current; its order of settle and cancel is not recorded, and the probe fixes the live order.

### Proposed row (011; `tiers.ts` was wave 15's, now on main)

**A cancelled forced run is queued forced again only while what forced it still holds.** 011 C4 step 5, 001-171's re-run rule (S1: "a file whose key moves before its re-run runs drops it, and the new key runs as any miss"). Seam: `recordTier`'s `requeue` branch in `src/core/scheduler/tiers.ts`. Lead: keep `forced` when the file is still at the key the tier ran it at, or when the open checkpoint holds the file strict (`run --all --force`, task 001-107: its re-queue keeps it forced across an install move); otherwise queue it as a normal miss, as `Ledger.discard` already does (`forced && file.key === key`). The install-moved `requeue` (001-107) and `requeueSplit` need the same check. Regression: the probe above with assertions. After the revert, the file's row has no pending phase, `run --all` requests nothing and completes at once, and no further run of the file starts. A second case: a forced `run --all` whose file is cancelled by a revision that moves its key still runs it forced at the new key.
