# Row 011-352: one wake and the rest signal

Worker 9b8a107e, wave 98 (`tasks/wave-98.md`, W1), 2026-11-15. Design: `research/scheduler-step.md`, decision 2, "The wake loop", "Timing differences", "Tests: replace, don't layer". Baseline: 011-351 (`dc62e4289`, 0.1.512). The row was done whole; no split.

## What changed

- `src/core/scheduler/step-events.ts`: the closed lists. `WAKE_ORDER` (the written order of a pass: command hold, merge hold, yield bound, slow release, slow lane, slot gather, claims, runner-part bound, pump), `WakeReason`, `SchedulerEvent` (`asked`, `slot-ran`, `tier-ended`, `runner-work-drained`, `stalled`, `closing`, `wake`), `wakeRank`.
- `src/core/scheduler/wakes.ts`: `Wakes`, the loop. `slot(reason, fire, { rank })` gives an owner a `WakeSlot` (`at`, `atMost`, `clear`, `drop`); the loop arms one timer through `Clock.arm` at the earliest wake. A pass takes one reading and runs each owner due at it in the written order, each with that reading; an owner an earlier one moved past the reading waits for its new wake; an owner's throw runs the others and is thrown after the pass. `track(promise)`, `aside(run)`, `locked(count)` (the `Mutex` count hook), `close()`, `wakes()`, `rest()`. The `?? new Wakes(hostClock(now))` fallbacks give an owner built outside a scheduler (as tests build them) a loop of its own.
- `Scheduler.rest()` (`src/core/types/scheduler.ts`, on the coordinator's call, reply to request 2ae24d5b): resolves when no pass runs, no tracked work is open, the lock has nothing queued or running, no wake is due, and this still holds after one `setImmediate`; reports the next wake and each owner's, and whether a busy store's resume is pending (card 9's own timer: reported, not waited for).
- `scheduler.ts`: the pump's five waits are one. `#nextEvent` waits for an event; `#eventOrAfter(ms)` states the pump's wake and waits for an event; `#claimWake` opens a claims window and states the claims owner's wake. `#notify(event)` posts a `SchedulerEvent` to `#events`, which the pump clears at each pass and reads only as "one came". Tracked: the pump, the drain, each flight (its runner's run set aside), the beside lane's release, the queued recheck of the tiers in flight, a command hold's end. The loop closes after the pump ended, so a slot record's gather still ends during a close.
- Owners, each with a slot of the scheduler's loop:
  - wake-only: `claims.ts` (`claimWindow` and `claimPoll`, a pure poll that replaces `claimWake`'s sleep loop; the scheduler's claims slot runs it every 250 ms); `slow-tier.ts` (`#arm` is `atMost`; `SlowHost.wakes`; the configured lanes rank 0, the default `slow` rank 1, so it runs last); `slot-records.ts` (the gather ends at its wake; `SlotRecordsOptions.wakes`, passed from `record.ts`); `hold.ts` (the poll; `MergeHoldOptions.wakes`; the check is tracked).
  - deciding: `command-hold.ts` (the wake at the earliest `until`; the 2^31-1 clamp moved to the loop); `slow-release.ts` (`atMost` at the earliest bound; the close is tracked); `yields.ts` (`TierYields` takes the loop as its second argument; the scheduler builds it in its constructor); `runner-work-bound.ts` (each call states a wake and drops it when it settles; `runnerPartBound(context)` passes `context.wakes` and `context.now`; `SchedulerContext.wakes`, on the coordinator's call, reply to request bab37107).
- `Mutex(now, counted?)`: the count hook, not a wrapper.
- `Clock.ticks?()` (`clock.ts`; host adapter `performance.now`), see "Decisions".

## The grep (done-when)

```
$ grep -rn "setTimeout\|setInterval\|timers/promises" src/core/scheduler/
src/core/scheduler/busy-resume.ts:97:    this.#timer = setTimeout(
src/core/scheduler/clock.ts:38: * `setTimeout` looked up at each arm, so `vi.useFakeTimers` still works; the
src/core/scheduler/clock.ts:46:      const timer = globalThis.setTimeout(fire, Math.min(Math.max(0, ms), MAX_TIMER_MS));
src/core/scheduler/local-permits.ts:1:import { setTimeout as sleep } from "node:timers/promises";
```

## Timing differences this row causes (the record's list)

1. **Owners due in the same millisecond run in the written order**, not Node's timer order (`wakes.test.ts`, "owners due at one time run in the written order").
2. **The merge hold's poll repeats `MERGE_HOLD_POLL_MS` after the previous check ended**, where a fixed 1 s `setInterval` skipped a tick while a check ran. A slow `git ls-files -u` now delays the next poll by its own length.
3. **Three owners on the scheduler's clock**: done in 011-351 (its notes). This row adds: the claims window's polls and the slot gather's wait are stated on the scheduler's clock; with the virtual clock a frozen commit gives the 25 ms gather (as 011-351 noted).
4. **The quiet wait stays relative to the plan's reading**: the pump states its wake at `now + (idle.wakeAt - idle.at)`, the same delay as before; 011-356 may use the absolute wake.
5. **A command hold's end waits for the loop's turn**: its wake runs in a pass; the end (`commandHold()`) is async and tracked, so it runs behind a pass already running (a pass is synchronous, so the wait is that pass's length, microseconds).

Smaller differences, not in the record:

- **Wakes fire after their delay on the loop's steady time** (see "Decisions"), so a wall clock that jumps does not move them, as with each owner's `setTimeout` before.
- **The claims wait's first poll** is stated on the scheduler's clock; with a `now` that stands still the window never ends, as before (the claims table's "frozen" row).
- **The slot gather resets its wait in the wake itself**, one microtask earlier than `sleep(...).then(...)` did.
- **A host timer clamped at 2^31-1 ms** (a command hold of over 24 days) fires at the range's end, finds nothing due and arms again, as `command-hold.ts` did itself.

## Decisions the record did not settle

- **The loop's time is a steady time, not the scheduler's reading.** A wake is stated on the scheduler's clock (`at`, `atMost`) and kept as its delay from the reading it was stated at, on the loop's steady time: the largest of `Clock.ticks()` (host: `performance.now`; absent: `now`) and the time each fired timer stood for. Reason: hundreds of tests inject a `now` that stands still (`now: () => NOW`) or fake `setTimeout` and `Date` but not `performance`; a loop that compared wakes with the reading never fired under a fixed `now` (011-351's load-budget table hung: each 25 ms recheck found nothing due), and under fake timers a short repeating wake starved a longer one. On the virtual clock steady time is its reading, so tables are exact. `Clock.ticks` is optional and additive; the virtual clock has none.
- **`rest()` on a virtual clock does not move time.** A wake already due fires only at `advance`, so a test advances by 0 first; `rest()` waits while a wake is due. `rest()` uses `setImmediate`; a test with fake immediates must advance them.
- **Where `rest()` and `Rest` live**: on `Scheduler` in `src/core/types/scheduler.ts` (coordinator, reply to request 2ae24d5b). `Rest.wakes[].reason` is a `string` there, since types do not import scheduler modules; `wakes.ts` fills it from `WakeReason`. `Rest.busyResume` reports card 9's pending resume.
- **Slow lanes' order inside one reason**: a slot's `rank`, then the order slots were made. Configured lanes are made in the policy's order when the policy is first synced; the default `slow` lane has rank 1 and runs last. All slow-lane wakes only pump, so the order does not change behaviour yet.
- **`SchedulerEvent`'s kinds** are the `#notify` sites as they stand, plus `wake`; `revision-arrived` and `request-taken` from the glossary reach the pump as `asked` (through `#pump()` while it runs) until 011-356 posts them at the intake.
- **The untracked-promise check** (`test/scheduler/untracked-promises.test.ts`) strips types with esbuild and parses with acorn (both already installed; TypeScript 7 has no JS API here). It flags a `void` of a call that is not `*.track(...)`, and an expression statement whose `.catch`/`.then`/`.finally` hangs on work started in the same statement. A `.catch(() => {})` on a promise held elsewhere (`ended.catch`) marks a rejection handled and passes. Allowed, each with its reason: `mutex.ts` `void this.#watchers.delete` (a Set's delete) and `request-intake-requests.ts` `void passes?.pass().catch(...)` (the lint pass's own work, spec 017, not the scheduler's). `busy-resume.ts` and `local-permits.ts` are outside (cards 9 and 10).
- **Outside the brief's file list, agreed with the coordinator** (reply to request bab37107): `record.ts` (`RecordHost.wakes`, passed to `SlotRecords`), `context.ts` (`SchedulerContext.wakes`); and `src/core/types/scheduler.ts` (`rest()`, `Rest`, `RestWake`; reply to request 2ae24d5b).

## Tests

- New: `test/scheduler/wakes.test.ts` (earliest wins; a past wake fires next; written order at one time, with two slow lanes; one reading per pass; an owner moved past the reading; clearing, dropping and closing disarm; a throw; rest with the next wake; no rest while a wake is due; rest under tracked work and the work it starts; under lock work; a set-aside run; a closed loop).
- New: `test/scheduler/untracked-promises.test.ts` (the check, and a fixture that it discriminates).
- Moved onto the virtual clock, cases unchanged in meaning: `slow-release.test.ts` (the unit cases; each step `advance` then `rest()`), `runner-part-bound.test.ts` (the bound's case; `clock.armed` for `vi.getTimerCount()`), `tier-yields-bound.test.ts`, `promoted-tier-bound.test.ts` (the loop's wakes for the fake timers, `clock.now()` for `Date.now()`). `busy-resume.test.ts` stays on fake timers (card 9).
- Changed: `clock-port.test.ts` (011-351's): the claims-window table is a table over `claimPoll` now that the sleep loop is gone (same four rows); review 0.1.512 S1: the host clock is built before `vi.useFakeTimers()`, and its default reading follows `vi.setSystemTime`, its arms the fake timer.

## Type changes (all additive)

- New modules: `step-events.ts` (`WAKE_ORDER`, `WakeReason`, `SchedulerEvent`, `SchedulerEventKind`, `wakeRank`), `wakes.ts` (`Wakes`, `WakeSlot`, `SlotOptions`, `WakeFire`, `WakesRest`).
- `Scheduler.rest(): Promise<Rest>`; `Rest`, `RestWake` in `src/core/types/scheduler.ts`.
- `Clock.ticks?(): number`.
- `Mutex` constructor's optional second argument `counted`.
- Optional `wakes` on `SlowHost`, `SlotRecordsOptions`, `MergeHoldOptions`, `CommandHoldOptions`, `SlowReleaseHost`, `RecordHost`, `SchedulerContext`; `TierYields`' optional second constructor argument; `RunnerPartBound(ms, wakes?, now?)`; `runnerPartBound` reads `now` and `wakes` from the context when present.
- `claims.ts`: `claimWake` removed (its only callers were the scheduler and 011-351's table); `ClaimWindow`, `claimWindow`, `claimPoll` added.

## Checks

- `pnpm run lint`: `Checked 3508 files ... No fixes applied.` `pnpm run typecheck`: exit 0.
- Direct runs (`env -u PLUGIN_ROOT -u PLUGIN_DATA node_modules/.bin/vitest run`), while Squeal waited for quiet: after the wake-only owners, 50 scheduler files (merge hold, claims, group lanes, slots, slow tier, quiet, slow release, command hold, tier yields, runner-part bound, capacity, install wait, reinstall, runtime gone), 213 tests passed; after all owners, 60 files including `model-scheduler.test.ts`, `test/run-evidence` and `test/daemon/slow-instance.test.ts`, 331 tests passed; `test/keys/key-format.test.ts`, `test/keys/validity/compare.test.ts`, `reach.test.ts`, `wakes.test.ts`, `untracked-promises.test.ts`, `clock-port.test.ts`: 62 tests passed (no key-format raise).
- `squeal status --wait 60000` over the changed `src/` and `test/` paths at revision 45 (`dd1b8b901`): 1298 test files selected, each with a current result; 4 known failures, all the committed bundles differing from the build (`test/harness/plugin.test.ts`, `codex/packaging/runtime.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`: `cli/squeal.mjs differs from the build`). Expected: the brief forbids `pnpm run build`; the coordinator rebuilds the bundles for the candidate. The 7 not-current files of the worktree are outside the selection (unknown).

## For 011-353

- The model test swaps the global `setTimeout` (`model-clock.ts:80`); every scheduler timer now goes through `hostClock`'s per-arm lookup, so its swap sees them all, the claims poll and the pump's waits included, which `node:timers/promises` hid before.
- The harnesses can pass `clock: virtualClock()` and await `scheduler.rest()`; advance by 0 before `rest()` when a wake may be due.
- `Wakes.wakes()` lists each owner's stated wake; `Rest.wakes` is the same at rest.
