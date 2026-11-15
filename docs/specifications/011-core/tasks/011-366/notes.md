# Row 011-366: the four decisions outside the step, and the step's one reading

Worker bbc0f68e, wave 105 (`tasks/wave-105.md`, W1), 2026-11-16. Evidence: `quality/2026-11-15-card-7.md` R3, S7 and the table under question 1. Builds on row 011-365 (`16b378628`, `tasks/011-365/notes.md`). Behaviour preserved; the timing differences are listed below.

## The shape: steps outside the pump's iteration

A site that is not the pump now steps on its own event with `reads: null`, as the revision pass, applied runner work and a taken request already did (`#stepOutside` in `scheduler.ts`, was `#stepInTurn`). Such a step runs only the rules in `OUTSIDE` (`step.ts`), in `RULES`' one written order: `holdBegan`, `yieldCheck`, `reinstallMissing`, `closeSlowLanes`, `closeBesideLane`, `inTurnEnds`. `inTurnEnds` moved to the end of `RULES` (a pump step never reaches it: `idleAnswer` always answers). Its turn's decisions are carried out as made; its after-turn decisions are the caller's (`StepLive.after`).

New events (`step-events.ts`): `hold-began`, `slow-ended {lane}`, `beside-ended {lane}`, `install-missing`. None is posted to the pump; `yieldReach` places each at `none`. New decision kinds, both placed `after`: `cancel-held`, `close-beside {lane}`. `close-lanes` now also closes a lane at its run's end.

## Each old site and its new rule

| Old site (at `3e6f167aa`) | What it decided | Now |
|---|---|---|
| `scheduler.ts:725-738` `commandHold()`, `:745-749` `#cancelHeld` | A command hold's start: preempt the lanes waiting for a load guard, cancel the tiers in flight whose runner cancels, await their end, pump. | `commandHold()` steps on `hold-began`. Rule `holdBegan` decides `cancel-held` and answers `again`; `StepLive.#cancelHeld` carries it out (preempt, abort, await); `commandHold()` then pumps on `again`. The pump's step closes the idle slow lanes, as before (`closeSlowLanes`). |
| `scheduler.ts:1460-1464` `#slowEnded` | A slow lane closes at its run's end, still in flight, when no file of it is queued or a hold stands. | `#fly` steps on `slow-ended {lane}` and awaits `after`. `closeSlowLanes` is the one close rule: a run's end closes its lane on a hold or with no file of it queued (`slowQueued` port); on a hold in the pump's iteration it closes the idle lanes and ends the pump. Carried out by `SlowRelease.closeIdle([lane])`, the same `release` per lane. |
| `scheduler.ts:521-525` `#pass` | The revision pass's install check found the install missing: `#reinstall`. | The pass steps on `install-missing`. Rule `reinstallMissing` is the one place a reinstall is decided: on that event, or in the pump's iteration when admission answers `install-missing` after the holds (moved out of `startFastTier`). Carried out in the turn, as before (`reinstall`). |
| `scheduler.ts:1517-1521` `#besideEnded` | A batch's tier or one beside it ended; with no batch left in the lane, its second instance closes (row 011-269). | The flight's end steps on `beside-ended {lane}`. Rule `closeBesideLane` decides `close-beside` when `besideDone` (port); the flight's end carries it out as a tracked piece, not awaited, as before. |
| `yields.ts:119` (`TierYields.check` reads `context.now()`) | The yield check's own reading. | `check(..., at)`: `StepLive.#checkYields` passes the step's reading (`StepPorts.carry(decision, at)`). The published row is stamped with it too (`#publish(context, at)`, agreed with the coordinator, reply to request 3bddfb46). Direct callers without `at` read now, as before. |
| `tier-live.ts:40` (`liveView` reads `context.now()`) | The fast plan's own reading. | `LiveViewOptions.now`: the plan (`StepPorts.startNext(admitted, at, fly)`) and the idle answer read when no plan ran (`idleNow(at)`) take the step's reading. |

`grep -n "#cancelHeld\|slowRelease.release\|#reinstall(" src/core/scheduler/scheduler.ts` finds only the host wiring `reinstall: (ledger) => this.#reinstall(ledger)`; `#cancelHeld`, `#slowEnded` are gone from `scheduler.ts`.

## Tests

- `step.test.ts`: a row for each new decision (hold start, a run's end with and without its files queued and on a hold, a pass's missing install, a flight's end with and without a batch left), a row that no pump rule runs outside the iteration, two rows that the step's reading reaches the plan, each start, the yield check and the idle answer. The closed list has 13 kinds.
- `step-reading.test.ts` (new): the one-reading row on a virtual clock that moves at every reading. Each yield check and each plan's queue order inside a step reads the step's reading. Removing the reading from the check, or only from the plan, fails it (checked).
- `tier-yields-clock.test.ts:176` (not mine; coordinator's agreement, reply to request 3bddfb46, own commit): `readsBeforeRow` 2 to 0. The decisions and the row's `at` take the step's reading, read before the check.

## Timing differences

- A hold's start: the step is synchronous and outside the lock, as `commandHold()` was; no lock hop added.
- A slow run's end: the close is one `Promise.all` over one lane (one microtask more).
- A flight's end: the beside close is tracked only when the step decided it, as before.
- Every step outside the iteration is heard by `onStep` listeners (`inTurn: true`, no reads): a hold's start, each slow run's end, each batch flight's end, a pass's missing install are new steps there.
- The yield row's stored time is the step's reading, earlier than before by at most the time from the step's start to the check (same lock turn, synchronous).
- `reinstallMissing` reads admission once more in a pump step that reaches it (a second `admit()` in the same turn); `startFastTier` no longer meets `install-missing`.

## Type changes

- `step-events.ts`: `SchedulerEvent` gains `hold-began`, `slow-ended`, `beside-ended`, `install-missing`; `StepDecision` gains `cancel-held`, `close-beside`; `DECISION_PLACE` has 13 entries.
- `step.ts`: `StepPorts.startNext(admitted, at, fly)` (was `(admitted, fly)`), `idleNow(at)`, `carry(decision, at)`, new `slowQueued(lane)`, `besideDone(lane)`.
- `step-live.ts`: `StepHost` loses `beside`, gains `running`, `releaseLane`; `inFlight` is `ReadonlyMap<string, LiveFlight>` (tier, done, held).
- `yields.ts`: `TierYields.check(..., at?)`; `tier-live.ts`: `LiveViewOptions.now?`.

## Decisions the record did not settle

- Steps outside the iteration run a subset of `RULES` (`OUTSIDE`), not a list of their own, so the written order stays one.
- `reinstallMissing` sets `selected` in the pump's iteration, as `startFastTier` did when it decided the reinstall: the busy resume's `landed()` still follows such a step.
- `step.ts` is 430 lines (was 327 at the wave's base, 345 after 011-365), over the styleguide's about 300. Splitting its interface types into a file of their own would bring it near 300; I left it whole so the rules and their ports read in one file. The coordinator's call.
- The model test was not run: the one-minute load stayed between 86 and 105 on 24 CPUs during the row.
