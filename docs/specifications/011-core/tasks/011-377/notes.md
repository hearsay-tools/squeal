# Row 011-377: waits that count from a stored calendar time

Worker 2249b18f, wave 112 W1 (`tasks/wave-112.md`), from main at 0.1.523 (`8c9e04358`).

## Design

### The problem in one line

Row 011-369 put every wake on elapsed time. But some owners decide whether a wait has ended by comparing a calendar reading with a calendar time they stamped earlier (or read from the store). When the calendar is set back 1 h, that comparison says "1 h more to go", so the owner states a new 1 h wake.

### The mechanism: a calendar step re-anchors local times

One new module, `src/core/scheduler/calendar-steps.ts`:

- The scheduler wraps its clock (`steppedClock`). Each calendar reading (`now()`) also reads elapsed time and computes the offset `calendar - elapsed`.
- A **calendar step** is a change of that offset by at least `CALENDAR_STEP_MS` (100 ms) from the last accepted offset. Why 100 ms, and why it is not tuned to this host (coordinator's ask, 2026-11-16):
  - Reading jitter: `Date.now` is whole milliseconds and `performance.now` is not, so the offset moves by under 1 ms between two readings with no clock change.
  - NTP slewing: a slew changes the clock's rate by at most 500 ppm (0.5 ms per second), and Linux applies it to `CLOCK_REALTIME` (`Date.now`) and `CLOCK_MONOTONIC` (`performance.now`) alike, so it does not move the offset.
  - NTP steps the calendar only when its error is above 128 ms; below that it slews. So a real clock change is a jump of more than 128 ms, or a person or a VM resume setting the clock.
  - A suspend: `CLOCK_MONOTONIC` stops while the host sleeps and the calendar does not, so a resume reads as a step forward. Each wait keeps the elapsed time it had left, as the wakes already do.
  - A change below 100 ms is not told; it moves a wait by under 100 ms.
- On a step of Δ ms (rounded), `CalendarSteps` tells each listener `shift(Δ)`, before the reading is returned. Each owner adds Δ to the calendar times it keeps in memory for its own waits and publishes again where it publishes.
- `CalendarSteps.total` is the sum of the steps seen. An owner that compares a stamp it did not keep in memory (a stored revision's `createdAt`, a tier's `startedAt`) remembers `total` when it first sees the stamp and adds `total - mark`.

Effect: a wait's calendar end minus the calendar now stays the elapsed time left. Every decision helper keeps its calendar arguments and the step's one reading `at` (row 011-372 kept). Nothing stored changes shape. A published end is in the calendar of the moment it is written, which is what a reader on the same host compares it with.

Known limit: a step that falls inside one step's turn, after its reading `at`, re-anchors the owners while the rest of that turn still compares with the older `at`. One decision of that turn can be off by the step. The next turn reads the clock again and is right. The window is the length of one turn (milliseconds).

Not moved: a step does not move a stamp already stored (a revision's `createdAt`, a run's `startedAt`, a claim, a hold row). Other processes read those.

### Each wait

| Wait | Owner (file) | Where its start comes from | Own start or seen | After a clock jump, a user sees |
| --- | --- | --- | --- | --- |
| A lane's quiet after a cancel, and catch-up's quiet | `BacklogQuiet` (`quiet.ts`) | This daemon's reading at the cancel, re-key or edit (`cancelled`, `queued`, `caughtUp`) | Own: in memory | The wait ends after its 20 s / 120 s of elapsed time. Status shows the end re-published in the new calendar. |
| A group's quiet after an edit (`at: "edit"`) | `quietLeftMs` (`slow-trigger.ts`), read by `SlowTier` and `momentHolds` | The latest revision's stored `createdAt` | Seen: counted from when this daemon first saw that revision (`CalendarSteps.local`). The stored `createdAt` is not changed. | The group runs `quietMs` of elapsed time after the edit. Before: a set back of 1 h held it about 1 h (the pinned case). |
| A named wait's deadline | `Promotions` (`promotions.ts`) and `FocusedEntries` (`focused-entries.ts`) | This daemon's reading plus the request's `withinMs` (`request-intake-requests.ts`); a predecessor's published list (`inherit`) | Own; an inherited one is seen at inherit and counts from there | The named files keep their priority for the elapsed time asked. The published promotions are written again with the shifted ends. |
| The claims window, and the waiter's bound on a claim | the scheduler's `#claimWindow` (`scheduler.ts`), `Claims.#seen` (`claims.ts`) | This daemon's reading when it opened the window or first saw the claim | Own | The 1 s window and the `timeoutMs + 6 s` bound are elapsed time. A claim's liveness stays as it is: it compares another daemon's heartbeat stamp (row 011-372's read path). |
| A command hold's end | `CommandHold` (`command-hold.ts`) | `until` written by the `squeal hold` process in the shared `commandHold` row | Another process's | **Not moved: the one wait left on calendar time** (coordinator's reply, 2026-11-16, decision D: a stored, compared time). The row is shared: the daemon prunes it, and status and `squeal hold` read `until` on the calendar. Counting it locally makes the daemon and status disagree about a hold. The holder's exit ends a hold first in practice; `until` is a 3 h safety bound. A set-back of 1 h keeps a hold whose command is still running up to 1 h longer; a set-forward ends it early. |
| The slow release's idle bound | `SlowRelease.#endedAt` (`slow-release.ts`) | This daemon's reading when a slow tier ended | Own | A slow lane closes 60 s of elapsed time after its last run. |
| The yield bound and the remainder | `TierYields.#bounds` (`yields.ts`); `remainder` (`yield-waits.ts`) from `Tier.startedAt` | The bound: this daemon's reading; the remainder: the tier's start, stamped by this daemon and stored as the run's start | Bound: own. Start: seen when the tier is made (`Tier.startedStep`, the steps total then) | A running tier yields for a named wait after the same elapsed time. Before: a set forward of 1 h made every tier with a named wait yield at once. |
| The yield row's ended-count throttle (`ENDED_WRITE_MS`, 2 s) | `YieldHistory.#endedAt` (`yield-history.ts`) | This daemon's reading at its last write | Own | Status's ended counts keep updating. Before: a set-back of 1 h stopped those writes for 1 h. |
| The drain time | the scheduler's `#drainBusyAt`, `SlowTier.#endedAt` (`slow-tier.ts`); compared in `lifecycle.ts` at the heartbeat | This daemon's readings | Own | A drain stops after its 60 s of elapsed time with no slow run (`DRAIN_SLOW_WAIT_MS`). `slowWaiting` reads the clock first, so a step is seen before `since` is returned. |

Out of this row, unchanged, with the reason:

- A consumer's liveness (`consumersIdle`, the `pause`/`stop` moments), claims' liveness, retries' liveness: each compares another process's stamp, written on the same calendar.
- `src/core/lint/pass/idle.ts:49` repeats the `edit` quiet for the lint pass. It is outside `src/core/scheduler/`.
- A tier's stored `durationMs` (`tiers.ts`, `record-tier.ts`): a stored span, not a wait.
- The slow lane's load budget: already elapsed time (row 011-369).

### Tests (written first, each failing before)

- `clock-port.test.ts`: the pinned row ("a calendar set back 1 h, past the edit, holds the group") flips: the group runs once its 5 s budget is spent.
- `clock-change.test.ts` (or a new file beside it), on the virtual clock, one case per wait moved: set the calendar back 1 h and forward 1 h after the wait starts, and check that the wait ends after its delay and not 1 ms sooner.
- `calendar-steps.test.ts`: a step below 100 ms is not a step; a step is told once, rounded; `local` counts from first sight.

## What changed

- New `src/core/scheduler/calendar-steps.ts`: `CalendarSteps` (`observe`, `onStep`, `total`, `local`, `since`), `CALENDAR_STEP_MS`, and `steppedClock`. The stepped clock is a named class (`SteppedClock`), so a stack names its frame; its readings are arrow fields, so a reading taken off it works as the host adapter's does.
- `scheduler.ts`: `#clock` is `steppedClock(clockOf(options), #steps)`. `#shift(ms, at)` is the one place that tells the owners; it is registered at the end of the constructor, once every owner exists. The context carries `steps`. `slowWaiting` reads the clock first, so a step moves `since` before `lifecycle.ts` compares it.
- Owners, each with a `shift(ms)` that adds the step to the calendar times it keeps:
  - `BacklogQuiet.shift(ms, at)` (`quiet.ts`): both maps; publishes again.
  - `Promotions.shift` (`promotions.ts`): `until` and `estimatedEnd`; publishes again. `FocusedEntries.shift` (`focused-entries.ts`): `until`. `RunQueue.shift` (`queue.ts`) calls both.
  - `Claims.shift` (`claims.ts`): `#seen`. The scheduler moves `#claimWindow.until`.
  - `SlowRelease.shift` (`slow-release.ts`), `SlowTier.shift` (`slow-tier.ts`) through `GroupTiers.shift` (`group-tiers.ts`): the lanes' ends.
  - `TierYields.shift` (`yields.ts`): `#bounds`, and `YieldHistory.shift` (`yield-history.ts`): the ended count's last write.
  - The scheduler's `#drainBusyAt`.
- Stored stamps, counted from first sight:
  - `quietLeftMs` (`slow-trigger.ts`): the latest revision's `createdAt` through `steps.local("revision", number, createdAt)`.
  - `remainder` (`yield-waits.ts`): `tier.startedAt` through `steps.since(startedAt, tier.startedStep)`. `newTier` (`tiers.ts`) sets `startedStep` right after its `startedAt` reading.
- `GLOSSARY.md`, "Elapsed time": waits that compare a calendar time count on elapsed time too; the one exception is a command hold's end.

The claims window, the drain time and the yield bound have no case of their own on a real scheduler. Their owner code is one line each in `#shift`, and `calendar-steps-scheduler.test.ts` fails when `#shift` is not registered.

## Tests

- `clock-port.test.ts`: the pinned row flips to "a calendar set back 1 h, past the edit, does not hold the group". Red before the change (Squeal at revision 4: `expected false to be true`), green after.
- New `calendar-steps.test.ts`, on the virtual clock under `steppedClock`:
  - `CalendarSteps`: a change of 99 ms is not told; a set-back of 1 h is told once, with its reading; `local` and `since` count from first sight.
  - One case per owner, the calendar set back 1 h and set forward 1 h after its wait began, each ending after its delay and not 1 ms sooner: the lane's quiet and catch-up's quiet (and the re-published ends), a named wait's deadline (`Promotions` and `FocusedEntries`), the waiter's bound on a claim, the slow release's idle bound (with a re-arm after the step), a tier's remainder.
- New `calendar-steps-scheduler.test.ts`: a real scheduler on the virtual clock; after a backlog tier's cancel, the calendar set back or forward 1 h; the backlog starts 20 s of elapsed time after the cancel, not before.
- Mutation checks, each run once and reverted:
  - `CalendarSteps.observe` never telling a step: all 11 owner and step cases fail, and the flipped `clock-port` row fails.
  - The scheduler's `onStep` registration removed: both `calendar-steps-scheduler` rows fail.

### Test files changed because they moved the calendar alone (coordinator's leave, 2026-11-16)

Each keeps its meaning:

- `test/helpers/virtual-clock.ts`, `harnessClock`'s host path: `advance(ms)` now moves elapsed time with the calendar. Tests call `advance` to say "this much time passed"; on 0.1.523 it moved the calendar alone, which now reads as a calendar step and would move the waits with it. Fixed by this alone: `focused.test.ts` case 4 (`advance(61_000)` past a named deadline), `tier-yields-named.test.ts` cases 3 and 6.
- `test/scheduler/claims-expiry.test.ts` case 10: the waiter's `now` skewed by `timeoutMs + grace + 1` becomes `b.advance(...)` on the same side: the bound passed.
- `test/scheduler/step-reading.test.ts`: `PASSING` adds `SteppedClock.now`, a frame that only passes a reading on, as `#now` does. No reading is added.

## Type changes (all additive)

- `SchedulerContext.steps?: CalendarSteps`.
- `Tier.startedStep?: number`.
- `shift(ms)` on `BacklogQuiet` (with `at`), `Promotions`, `FocusedEntries`, `RunQueue`, `Claims`, `SlowRelease`, `SlowTier`, `GroupTiers`, `TierYields`, `YieldHistory`.
- New exports: `CalendarSteps`, `CALENDAR_STEP_MS`, `steppedClock`.

## For the next worker

- A wait owner that keeps a calendar time for its own wait adds a `shift(ms)` and a line in the scheduler's `#shift`. One that compares a stored stamp uses `context.steps.local(kind, id, stamp)` (one id per kind) or keeps the steps' `total` beside its stamp and uses `since`.
- A fixture that freezes `now` or runs it at another speed, with the host's elapsed time, now reads as calendar steps: its waits count on the host's elapsed time. Use the virtual clock, or `advance` on the harness, to say time passed; use `shiftCalendar` to say the clock was set.
- Known limit: a step inside one step's turn, after its reading, can move one decision of that turn (Design).

## Checks run (2026-11-16, on `fb0dc2e3c`)

- `pnpm run lint`: clean. `pnpm run typecheck`: clean.
- `key-format.test.ts`, `model-scheduler.test.ts`, `model-harness-clock.test.ts`: 27 of 27 pass, load 20.8 to 23.8 on 24 CPUs (below the CPU count at the start).
- Direct runs, `--maxWorkers=4`: 77 wait-related scheduler files (4 failures, all fixtures that moved the calendar alone, fixed above); 9 files with calendar skews: pass; the 136 `test/daemon/` and `test/scheduler/` files Squeal had not reached: 136 of 136 pass, 559 tests, load 15 at start, 31.7 at end, 651 s.
- Squeal, `squeal status --wait` on the changed paths, two waits (57 min and 30 min) on a busy host: 690 test files current and passing. 4 known failures, all bundle drift (`cli/squeal.mjs differs from the build` in `plugin.test.ts`, the Codex, OpenCode and Pi package tests): `plugins/*/dist` is not this row's; the landing rebuilds it. 232 test files still queued, 7 unknown when the daemon was stopped: mostly `test/cli/`, `test/harness/`, `test/integration/`. They are not verified here.

## Repair after review 0.1.524

Review `reviews/0.1.524.md` FAIL: B1, B2 blockers, S1 should-fix, N2 nit. Brief: `tasks/wave-112.md`, "W1 repair". Commit `5480be5eb` and the docs commit after it.

### B1: a live daemon's rows after a set-back

The readers take a row only when its stamp `at` is not before the live daemon's stored start (`publishedWaits`, `publishedBatches`); after a set-back past the start, the shift's re-publication was rejected as a predecessor's. The coordinator chose design A (2026-11-16): no shape change, readers unchanged.

- `CalendarSteps.stamp(at)`: `max(at, this daemon's stored start)`. The scheduler gives it the start through `#daemonStartedAt()`: the worktree's daemon record whose `daemonIncarnation` equals `SchedulerOptions.incarnation`, cached once found. A predecessor's or a successor's record never matches, so a predecessor's late row keeps its own, earlier start and is still rejected. Without an incarnation (a scheduler outside a daemon) nothing is clamped.
- The quiet row (`scheduler.ts`, `publishQuiet`) and the promotions row (`ledger.ts`, `publishPromotions`) are stamped with it.
- After a set-back past the daemon's start, those rows' `at` shows the daemon's start, not the reading. Their ends are in today's calendar.
- Same pre-existing exposure, not changed here (the coordinator files it as its own row): the yields row (`writeYieldRow`, read by `readYieldRow`) and the pool-wait row (`publishPoolWaits`, read by `publishedPoolWaits`) are stamped with the reading, so any write after a set-back past the start is read as a predecessor's.

### B2: a step between a decision and its wake's delay

Rule: an owner reads the clock once, before it reads the calendar times it keeps; a calendar step that reading sees has moved those times first, so the delay holds no step. A calendar time copied out of a reading carries the steps' total at that reading and is moved by later steps before it becomes a delay.

- `SlowRelease.arm`: one reading decides and gives the delay (was: `#decide()` read, then `- now()` read again). Proven case.
- `TierYields.#arm`: the reading before `Math.min(...bounds)`.
- The pump: `Step.mark` (new, optional) is the steps' total at the step's reading (`StepLive.step`, through `StepHost.stepsTotal`). `#waitFor` passes it on; `#eventOrAt` reads first and states `steps.since(at, mark) - now`; `#claimWake` reads first and opens the window at `steps.since(at, mark)`.
- `step-reading.test.ts`: the slow release's wake reading now names `SlowRelease.arm < StepLive.step` (it moved out of `#decide`); it is the same wake bookkeeping reading.

### S1: a pause inside a sample

`SteppedClock.now` reads elapsed time, the calendar, and elapsed time again. `observe` uses the midpoint and leaves out a sample whose span is wider than `SURE_SAMPLE_MS` (50 ms, half of `CALENDAR_STEP_MS`): the offset of a sure sample is known to 25 ms, so two sure samples differ by less than 100 ms without a step. A left-out sample tells nothing; the next sure one tells a real step. The limits of the NTP model are in the `CALENDAR_STEP_MS` comment: an NTP client that steps under 100 ms, or a monotonic clock with another rate, moves a wait untold by up to that amount; ntpd's and chrony's settings were not tested.

### N2

`GLOSSARY.md`, "Elapsed time": the command hold is the one scheduler wait that still moves; the lint pass's copy of the edit quiet (`src/core/lint/pass/idle.ts`) still compares the stored revision time, held by row 011-382.

### Tests (each failed before its fix)

- `calendar-steps-seams.test.ts` (new):
  - B1: owner to public reader, a real daemon record in a real store: the quiet row and the promotions row read as the live daemon's after a set-back and a set-forward of 1 h; a predecessor's row written after its successor started, the calendar set back first, is still rejected. Red before: `CalendarSteps.stamp` did not exist; mutation `stamp` returning the reading fails the two set-back rows.
  - B2, slow release: the review's wrapper, the calendar stepped on reading 2 or 3 of `ended`, back and forward: the lane closes 60 s after, not 1 ms sooner. Red before: set back on reading 3 (the review's 3,660 s case).
  - B2, yield bound: the calendar stepped on the first reading inside `TierYields.#arm`, back and forward: the tier yields 30 s past its estimate. Mutation (the old `min - now()` order) fails the set-back row.
- `calendar-steps-scheduler.test.ts`: a real scheduler, the calendar set back 1 h on the first reading inside `#eventOrAt` after a cancel: the backlog starts 20 s after the cancel. Mutation (`at - now`, without `since`) fails it.
- `calendar-steps-sample.test.ts` (new), S1: time passes inside elapsed reading 1, 2, 3 or 4 of two samples, with no calendar change: no step is told, and a real set-back after is. Mutation (no width check) fails readings 2 and 4, the ones that follow a calendar reading.
- The set-forward rows of B2 passed before too: a forward step there gives a short or negative delay, and the owner reads again at once.

### Type changes (additive)

- `CalendarSteps` constructor `startedAt?: () => EpochMs | null`; `CalendarSteps.stamp`; `observe(calendar, before, after?)` (was `observe(calendar, elapsed)`); `SURE_SAMPLE_MS`.
- `Step.mark?: number`; `StepHost.stepsTotal(): number`.
