# 004-59 notes: an explicit `run --slow` skips the load guard

Spec 004 D3 as amended 2026-10-14. Found by 006-54: under load, `run --slow --wait 90000` timed out because `SlowTier.next()` called `waitForCapacity` whether or not a request was open, so the files waited up to `slow.maxDeferMs` (600 s).

## The seam

- `src/core/scheduler/slow-tier.ts`, `SlowTier.next()`: `#requested` (set by `request()`, cleared in `#candidates` once no slow file is pending) now chooses `#skipGuard` over `#waitForCapacity`. Both return a `Guarded`: `ranUnderLoad` (the D3 note's load, only at the bound) and `idle` (load at or below `slow.maxLoadPerCpu`, which D2's idle width needs). Before this change `want` read `load === null` for both.
- `#skipGuard` reads the load once through `loadPerCpu` (new export in `src/core/slow/guard.ts`, which `waitForCapacity` now uses too), does not wait, spends none of the pass's `slow.maxDeferMs` budget, and adds no "ran under load" note.
- `request()` now calls `preempt()`: a guard wait already in progress (the idle trigger waiting for load) is aborted, `next` returns `"again"`, and the pump plans again with the request open. Without it the request would sit behind the 15 s recheck at best, the remaining budget at worst.
- Left unchanged: `#candidates` still returns nothing while `editPending()` (behind pending fast work); the slot (`acquireSlowSlot` with `slow.maxParallel` permits, the waiter's mark, the turn hand-over); `nice` 10 and `ionice` (the runner, not this file); the idle trigger and `run --all` still take the guard while no request is open.

## Decision the amendment did not settle

The width under load. D2 lets a tier take up to `slow.maxParallel` files only "when the machine is idle", with the load below `slow.maxLoadPerCpu` as part of the definition. The amendment says the request's files run "within `slow.maxParallel` permits". I kept D2's idle width: a request under load runs one file at a time, without waiting between files; below the threshold it takes up to `maxParallel` as before. The alternative was one line: `idle: true` in `#skipGuard`, so a request takes up to `maxParallel` files under load too. The coordinator confirmed the default on 2026-10-14 ("runs them now" stays true and the host is spared) and words D3 to match.

## The status line

`slowTierText` (`src/core/state/slow-text.ts`) says "N pending, waiting for host load to drop; … `squeal run --slow` runs them now." The request now starts the tier at once (behind fast work and the slot), so the line is true and its wording is unchanged.

## Probe

`test/scheduler/slow-request-load.test.ts`, injected load 8 per CPU that never drops, default `slow.maxDeferMs`:
- no consumer (the idle trigger): after several guard reads no slow file ran and the activity is `waiting for load`; `requestSlowSuite()` then runs both files well inside 30 s, one at a time (`[1, 1]`), with no "ran under load" note;
- once the request's pass ends, an edit re-queues the slow files and they wait for load again.
With `src/` reverted to before this change, both tests fail on the 30 s wait for the request's runs.

## For 006-54

The board row's done-when puts `a8-load-hold`'s `maxDeferMs` back to the default. That scenario is not on this branch yet, and it belongs to 006-54's files, so this row did not touch it.
