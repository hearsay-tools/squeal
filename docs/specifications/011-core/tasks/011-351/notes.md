# Row 011-351: one clock for the scheduler

Worker af2e296a, wave 97 (`tasks/wave-97.md`, W1), 2026-11-15. Design: `research/scheduler-step.md`, "The clock port".

## What changed

- `src/core/scheduler/clock.ts`: the port `Clock` (`now()`, `arm(ms, fire) => Disarm`), `hostNow` (the only host read), `hostClock(now?)` (looks `setTimeout` up per arm, clamps the delay to 0..2^31-1 ms, unrefs), `clockOf(options)` (`clock`, else `hostClock(now)`), `elapsed(earlier, later)` (a difference clamped at 0).
- `SchedulerOptions.clock` (additive). `SchedulerOptions.now` stays as shorthand for `hostClock(now)` and is ignored when `clock` is given.
- `TierScheduler` builds the clock once and hands `#now` (a reading of it) to every owner: its lock (`Mutex`), `StoredKeys`, `MergeHold`, `CommandHold`, `PoolWaits`, `SlowRelease`, `SlowHost.now`, the context's `now`, `WorktreeKeys` (new optional `KeyingOptions.now`), `claimWake`, and notes.
- `test/helpers/virtual-clock.ts`: `virtualClock(start)` with `now`, `arm`, `advance(ms)` (fires due timers at their own time, in time order, then arm order) and `armed`.
- No timer moved to the port; the arm exists for 011-352. Nothing calls `Clock.arm` in `src/` yet.

## The grep (done-when)

```
$ grep -rn "performance\.now\|Date\.now" src/core/scheduler/
src/core/scheduler/clock.ts:26:export const hostNow = (): EpochMs => Date.now();
```

## Timing difference: three owners moved off the steady clock

These read `performance.now` before and the scheduler's clock now (host default: `Date.now`). A wall clock that jumps can shorten or lengthen them; a difference is clamped at 0, so a clock that goes back gives nothing back.

1. **The slow lane's load budget** (`slow-tier.ts`, `#endDeferral`, `#guard`, `#arm`): the time a load guard wait took off `slow.maxDeferMs` is `elapsed(from, now)`. Also the `#timerAt` comparison in `#arm`.
2. **The claims window** (`claims.ts`, `claimWake`): the 1 s window is `now() + CLAIM_RECHECK_MS`, read on the clock the scheduler passes. Not a difference, so nothing to clamp: a clock that goes back makes the window longer, a jump forward ends it at the next 250 ms poll.
3. **A slot gather's commit time** (`slot-records.ts`): `#commitMs = elapsed(started, now())`. On a virtual clock that does not move during a commit it is 0, so the gather is always `SLOT_GATHER_MS` (25 ms), as the record expected.

Other owners that move to the injected clock, a difference only in tests that inject `now`: the lock holder's `since` (`Mutex`, was always `Date.now`), the environment record's stamp (`keying.ts:362`, was always `Date.now`), and the `Promotions` default before `setClock` (the queue sets the clock at once). In the daemon, `now` is not injected, so these read `Date.now` as before.

A second, smaller difference: owners that took `options.now ?? Date.now` held the `Date.now` function of construction time; `hostNow` looks `Date.now` up per call. A test that installs fake timers after it built a scheduler now reads the fake `Date` there (as the context's `now` already did).

## Tests

- New: `test/scheduler/clock-port.test.ts`, 11 cases.
  - Adapters: the clamps, `clock` over `now`, the virtual clock's order.
  - Claims window table: a frozen clock never ends it; 1 ms short does not; the window passed does; a clock that went back does not.
  - Load budget table (a real scheduler on the catch-up fake runner, `now` from a virtual clock, real rechecks of 25 ms): a frozen clock spends nothing; 4999 ms of 5000 does not run; 2.5 s + 2.5 s runs; 3 s, back 2 s, 2 s forward runs (5 s spent, not 3 s).
- The load budget's back row fails without the clamp (checked once in a private `/tmp` copy with `this.#now() - deferred.from`: `× a clock that went back gives none back`).
- A back jump past the edit itself stalls the lane through other waits (the edit's own quiet), so the row keeps the clock after the edit.
- No existing test file changed. The tables use the `now` shorthand: the harnesses (`catch-up-fixture.ts`, `vitest-harness.ts`) pass no `clock` yet; 011-353 adds `clock: "virtual"`.

## Decisions the record did not settle

- **The arm's shape**: `arm(ms, fire)` with a relative delay (the brief: "clamps the delay"), returning a `Disarm`. 011-352 may prefer an absolute `at`; the change is local to `clock.ts` and the virtual clock.
- **`record.ts` gets one clock line** (`now: () => host.started().context.now()` for `SlotRecords`). It is not in the brief's file list, but without it the slot gather would stay on the host clock. `record-tier.ts` (card 1) is untouched.
- **Optional `now` on module options** (`SlowHost.now`, `SlotRecordsOptions.now`, `KeyingOptions.now`, `claimWake`'s third argument), each defaulting to `hostNow`, so the existing tests that build these directly compile and run unchanged. 011-352 or a quality row can make them required.
- **One reading per decision**: the decisions that take `now` already get the caller's reading (`Claims.holds(key, at)` with `#live(at)`). One pass of the slow lane still reads twice, `#endDeferral` then `#guard`'s `from`; on the virtual clock the two are equal. The step (011-356) gives one reading per turn.

## Type changes (all additive)

- New exports in `src/core/scheduler/clock.ts`: `Clock`, `Disarm`, `MAX_TIMER_MS`, `hostNow`, `hostClock`, `clockOf`, `elapsed`.
- `SchedulerOptions.clock?: Clock`.
- `SlowHost.now?: () => EpochMs`, `SlotRecordsOptions.now?: () => EpochMs`, `KeyingOptions.now?: () => EpochMs`.
- `claimWake(store, signal, now = hostNow)`.

## For 011-352

- Arm the loop's one timer through `Clock.arm`; the host adapter already clamps and unrefs, so `command-hold.ts:153`'s clamp can go when its timer moves.
- `virtualClock.advance` fires timers synchronously; an owner whose `fire` awaits needs the loop's `rest()` between advances.
