# 004-84 notes: the load guard decides whether the slow lane runs, not which worktree runs it

Worker notes, 2026-10-21. Brief: `../wave-15.md`, section "004-84".

## What changed

`SlowTier.next()` (`src/core/scheduler/slow-tier.ts`) now runs in this order:

1. `#candidates()` as before.
2. The guard. It is skipped for an open `run --slow` request (004-59) and for a marked waiter (`#marked`, new). Otherwise `#waitForCapacity` runs the load guard with `giveWay: () => slowSlotHeld(...)`.
3. When the guard gives way (`"held"`), or the slot is missed, or the holder yields its turn, `#waitAtSlot` marks the waiter, publishes `waiting for slot`, and arms the 15 s recheck. This is the old miss path, moved into one method.
4. Otherwise the yield check and `acquireSlowSlot` run as before.

New in `src/core/slow/guard.ts`: `CapacityWait.giveWay` and `CapacityWaited.gaveWay`. New in `src/core/slow/slot.ts`: `slowSlotHeld`.

## Decisions the brief did not settle

1. **"Another worktree holds the slot" means that every permit is held.** In that state, `acquireSlowSlot` would get none. With `slow.maxParallel` above 1 and one permit free, a new file adds load, so the guard still decides. The alternative is to treat a single permit held by another worktree as "held". Then the slow lane runs one file at a time for the whole user under load. That alternative also needs a daemon past its budget to wait at the slot instead of taking a free permit. I did not build it. It changes more than the brief's seam, and cezar runs `slow.maxParallel: 1`, where both readings are the same.
   The coordinator accepted this default on 2026-10-21. It touches D3's "Above `slow.maxLoadPerCpu` (default 1.0) the file waits …". The proposed addition below says "every permit of the slot" for this reason.
2. **The slot is checked inside the guard, before each sleep.** So it is checked only when the load is above `slow.maxLoadPerCpu` and budget is left. This covers two cases with one check: the slot is held when the guard starts, and another worktree takes the slot during the wait. Below the threshold, nothing checks the slot. The test proves this with a spy. A daemon past its budget never checks either, because the guard returns at the bound first.
3. **The check locks each permit and releases it at once, with `BEGIN EXCLUSIVE` then `ROLLBACK`.** It does not write the holder row, so gh-58's holder diagnostics keep the real last holder. Cost: a taker that tries at the exact moment of the check misses. It retries at `SLOW_RECHECK_MS`, and as a marked waiter it then skips the guard.
4. **A marked waiter skips the guard, as `run --slow` does.** It spends no budget and gets no "ran under load" note. It reads the load once for D2's width, so under load it runs one file. The note says the guard waited `slow.maxDeferMs`, and that is not true at a handover.
5. **A handover is any free slot that a marked waiter finds.** That is the holder's yield, or the holder's drain when its last slow file ends. A holder that yields its turn also marks itself. When no other worktree took the slot, its next pass takes the slot without a guard wait. In every case, the file that runs replaces one that just ended, so the slot's load does not change.
6. **The budget is spent only in the guard.** Time a daemon waits at the slot does not count against `slow.maxDeferMs`. Time in the guard before it gives way does count.

## D3 sentences this change contradicts (for the coordinator's amendment)

- "Before each slow file the daemon reads the 1-minute load average per CPU … Above `slow.maxLoadPerCpu` (default 1.0) the file waits, rechecking every 15 s, at most `slow.maxDeferMs` (default 600000) per tier". This is now true only while the slot is free. Proposed addition: "While another worktree holds every permit of the slot, the file waits at the slot as a marked waiter instead (D2), and takes the slot at the handover without a guard wait. The wait would lower no load, because the slot stays busy; it would only pick which worktree runs (task 004-84)."
- "past that it runs and the run carries one note saying it ran under load L". A file that runs at a handover carries no note, even under load.
- Not new: D3 says the budget is "per tier", but the code keeps it per pass (`#budgetMs`, which resets when no slow file is pending). I did not change this.

D2's slot paragraph still holds: "A daemon that cannot take the slot within its turn keeps its slow files pending and retries on the next scheduling pass". The D8 texts name no order, so none changed. When the slot is held under load, the `Slow tier:` line now says the files wait for the slot, not for load. `status.md`'s 004-30 entry ("the load guard waits before the slot is taken") is a log line. It is now true only for a free slot.

## Tests

- `test/scheduler/slow-slot-fair.test.ts`, new. Two daemons of two repositories share one slot directory with one permit, and the load is injected at 8 per CPU. Daemon `a` is past its 100 ms budget. Daemon `b` is fresh, with the default 10 min budget.
  - The fresh daemon waits at the slot and runs at the next handover. The run order starts `a, b`. This test fails on the baseline (`b` waited for load).
  - A guard wait gives way when the other worktree takes the slot. This test fails on the baseline.
  - With the slot free and the load above the threshold, the file defers. It shows `waiting for load` and leaves no mark.
  - Below the threshold, the order is `a, b, a, b, a`. No load note appears, and the slot is never checked.
- `test/slow/guard.test.ts`: `giveWay` ends the wait before a sleep and keeps the time waited. It is not asked below the threshold or when the budget is spent.
- `test/slow/slot.test.ts`: `slowSlotHeld` returns false for a missing directory and does not create it. It returns true only when every permit is held. It takes no permit and leaves the holder row alone.
- Timing: the strict order checks use `recheckMs: 25`. The waiter's retry timer was set before the yielding holder's timer, so it is due first.

## For the next worker or the coordinator

- The version bump and `plugins/*/dist` are not in this row. Until the rebuild, the four bundle-drift tests fail: `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/pi/package.test.ts` and `test/harness/opencode/package.test.ts`.
- If the human later wants a user-wide limit of one slow file under load with `slow.maxParallel` above 1, that is a new row (decision 1).
