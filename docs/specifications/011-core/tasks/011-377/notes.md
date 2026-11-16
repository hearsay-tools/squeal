# Row 011-377: waits that count from a stored calendar time

Worker 2249b18f, wave 112 W1 (`tasks/wave-112.md`), from main at 0.1.523 (`8c9e04358`).

## Design

### The problem in one line

Row 011-369 put every wake on elapsed time. But some owners decide whether a wait has ended by comparing a calendar reading with a calendar time they stamped earlier (or read from the store). When the calendar is set back 1 h, that comparison says "1 h more to go", so the owner states a new 1 h wake.

### The mechanism: a calendar step re-anchors local times

One new module, `src/core/scheduler/calendar-steps.ts`:

- The scheduler wraps its clock (`steppedClock`). Each calendar reading (`now()`) also reads elapsed time and computes the offset `calendar - elapsed`.
- A **calendar step** is a change of that offset by at least `CALENDAR_STEP_MS` (100 ms) from the last accepted offset. The host's two readings jitter by about 1 ms (`Date.now` is whole milliseconds). NTP steps the clock only for offsets above 128 ms and slews below, and a slew moves `CLOCK_MONOTONIC` (`performance.now`) too. So a smaller change is not a clock change. The value is not tuned to this host.
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
| A command hold's end | `CommandHold` (`command-hold.ts`) | `until` written by the `squeal hold` process in the shared `commandHold` row | Another process's | **Not moved; asked of the coordinator.** The row is shared: the daemon prunes it, and status and `squeal hold` read `until` on the calendar. Counting it locally makes the daemon and status disagree about a hold. The holder's exit ends a hold first in practice; `until` is a 3 h safety bound. |
| The slow release's idle bound | `SlowRelease.#endedAt` (`slow-release.ts`) | This daemon's reading when a slow tier ended | Own | A slow lane closes 60 s of elapsed time after its last run. |
| The yield bound and the remainder | `TierYields.#bounds` (`yields.ts`); `remainder` (`yield-waits.ts`) from `Tier.startedAt` | The bound: this daemon's reading; the remainder: the tier's start, stamped by this daemon and stored as the run's start | Bound: own. Start: seen when the tier is made (`Tier.startedStep`, the steps total then) | A running tier yields for a named wait after the same elapsed time. Before: a set forward of 1 h made every tier with a named wait yield at once. |
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
