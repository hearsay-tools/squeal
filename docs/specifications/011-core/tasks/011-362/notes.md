# Rows 011-362 and 011-364: one wake loop and one clock

Worker 35c1f661, wave 104 (`tasks/wave-104.md`, W1), 2026-11-15. Evidence: quality `quality/2026-11-15-card-7.md` S1 and R1. One notes file for both rows, as the brief asks.

## 011-362: a revision's runner part arms its bound on the scheduler's loop

- `refinement.ts` `fetchRunnerPart` built `new RunnerPartBound(ms)` with no `wakes` or `now`. It now calls `runnerPartBound(context)`.
- The fix alone was not enough for `rest()`: a stalled call still counted as open work, so `rest()` never came on the virtual clock. `RunnerPartBound.call` now waits through `Wakes.waitFor({ for: "wake", reason: "runner-part-bound" }, …)`, the same named wait the slot gather takes. While the runner works on a call, the scheduler waits for the answer or the bound's wake, and `rest()` reports that wake.
- Test: `test/scheduler/runner-part-bound.test.ts`, "a revision's runner part arms its bound on the scheduler's loop (row 011-362)". It runs on the catch-up fixture with `clock: "virtual"` and a 60 s bound, stalls the next `invalidate`, and expects `rest()` within 5 s of real time with the `runner-part-bound` wake at the edit's time plus 60 s. Then `advance(60_000)` abandons the call with the note `runner invalidate (src/a.ts) failed: no answer within 60 s; …`.
- Before the fix the test failed with `expected 'unsettled' not to be 'unsettled'`. With only the one-line fix it failed the same way. With the named wait as well, it passes.

## 011-364: `wakes` and `now` required

- Required now: `CommandHoldOptions.wakes`, `MergeHoldOptions.wakes`, `SlotRecordsOptions.now` and `.wakes`, `SlowReleaseHost.wakes`, `RunnerPartBound(ms, wakes, now)`, `runnerPartBound`'s `now` and `wakes`, `SchedulerContext.wakes`, `RecordHost.wakes`, `KeyingOptions.now`, `Mutex(now, counted?)`, `TierYields(recheck, wakes)`, `TierYields.check(…, held)`.
- Gone: `SlowReleaseHost.endedAt?` (only `test/daemon/slow-instance.test.ts` passed it). Those cases now call `release.ended(lane)`, as the scheduler does when a slow tier ends. Without an end, a lane counts from each new reading and never closes.
- Promotions (coordinator's call, reply to request 44672c11): `Promotions` and `RunQueue` take a `PromotionClock` (`now`, `isRunning`, `publish?`) at construction. `Ledger` builds its `RunQueue` with the clock it passed to `setPromotionClock` right after construction before. `setPromotionClock` and `Promotions.setClock` are gone. No reading can come before the clock, so no failure mode was added. Behaviour is preserved: the Ledger is the only builder in `src`, and it set the same three functions before any use.
- `daemon-keys.ts` (the `ci export` and gate key path, with no scheduler) imports `hostNow` for `KeyingOptions.now`. The source test names it as the one allowed user outside `clock.ts`, with that reason (coordinator's call).
- `TierYields.#arm(_context)`: the parameter is unused now. Dropping it changes a call inside `check`'s body, which row 011-361 owns, so it stays until that row lands.
- Tests outside the listed set, edited by agreement (one line each): every `new WorktreeKeys` and `new Mutex()` caller in tests passes `() => Date.now()` (commit `699fc8ee6`). The `RunQueue` tests pass a clock at construction. Bare queues use `HOST_PROMOTIONS` (`test/scheduler/promotion-clock.ts`), the host clock with no file running, as before. `queue-promotion.test.ts`'s re-clocking case sets `clock.read` instead of calling `setPromotionClock` again.
- Tests that run in real time keep a host loop: `slot-records.test.ts` (a slot ends 5 ms later in real time) and `slow-instance.test.ts` (the runner's own runs) pass `new Wakes(hostClock())`, which is what the fallback gave them. The others pass `new Wakes(virtualClock(…))`.

## The source test

`test/scheduler/one-loop-source.test.ts` parses each `src` file that names `Wakes`, `hostNow` or `hostClock` (esbuild strips types, acorn parses). No `new Wakes(` is allowed outside `core/scheduler/scheduler.ts`. No `hostNow` or `hostClock` identifier is allowed outside `core/scheduler/clock.ts` and `core/scheduler/daemon-keys.ts` (named, with its reason). A second case plants a fallback (`options.wakes ?? new Wakes(hostClock(options.now))`, `options.now ?? hostNow`) and expects the three offences. Before the change, the first case listed 17 offences in nine modules.

## The grep (done-when)

```
$ grep -rn "?? new Wakes(\|= hostNow" src/core/scheduler/
src/core/scheduler/clock.ts:41:export function hostClock(now: () => EpochMs = hostNow): Clock {
$ grep -rn "?? new Wakes(\|= hostNow" src/core/scheduler/ --exclude=clock.ts
$
```

The one match is the host adapter's own default inside `clock.ts`, where the host clock is defined. The source test allows it.

## Type changes

Not additive: the parameters above became required, and `SlowReleaseHost.endedAt`, `RunQueue.setPromotionClock` and `Promotions.setClock` are gone. New exports: `PromotionClock` (`promotions.ts`). New constructors: `RunQueue(clock)` and `Promotions(clock)`. No change in `src/core/types/`.

## For the next worker

- Row 011-361 (W2) may drop `TierYields.#arm`'s unused `_context` once its `check` body lands.
- `options.ts:144-146` still documents `SchedulerOptions.now` as a shorthand over `hostClock`. Row 011-369 (R4) removes it.
- Row 011-363 and row R7 can now put `runner-part-bound.test.ts`'s real-time case on the virtual clock (row 011-360).
