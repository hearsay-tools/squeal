# 011-382 notes: the lint pass's edit quiet across a calendar step

Worker 54a85ba0, wave 117 W1, 2026-11-16. Base main `2ca6a943c` (0.1.526). Shape: slice. No version raise.

## Design

- `lintIdleIn` (`src/core/lint/pass/idle.ts`) reuses row 011-377's mechanism, not a third copy of it: it owns one `CalendarSteps` and reads its calendar through `steppedClock`. The latest revision's stored `createdAt` is counted from when this wait first saw it (`CalendarSteps.local("revision", number, createdAt)`), as the scheduler's `quietLeftMs` (`slow-trigger.ts`) does.
- `LintIdleOptions.now` is replaced by a required `clock: Clock` (calendar and elapsed readings). The daemon passes `hostClock(this.#now)`, as it does for the scheduler. A host-clock fallback inside `idle.ts` was tried first; `test/scheduler/one-loop-source.test.ts` rejects any source but the clock and its listed users that names `hostClock`, so the daemon names it.
- Not shared with the scheduler's `CalendarSteps`: that would need a scheduler accessor (outside this row's files) and the lint pass is made before the loop. Its own instance sees the same steps, at its own readings.
- `quietLeft` itself (`created + quietMs - now`) stays a two-line expression beside the scheduler's. Calling `quietLeftMs` would need a `SchedulerContext` and a `ResolvedGroup` the lint pass does not have.

## Known limit

A step is seen at this wait's next reading. A step that falls between an edit and this wait's first reading of that revision is not counted (the scheduler's quiet has the same rule, but reads the clock far more often). In practice the pass reads the wait on the nudge that follows an edit, when a stale part is next; with no stale part, no wait matters.

## Ownership

- Owned: `src/core/lint/pass/idle.ts`, `test/lint/pass/idle.test.ts`.
- Outside `src/core/lint/pass/`: one wiring line in `src/core/daemon/daemon.ts` (the call site of `lintIdleIn`: `clock: hostClock(this.#now)` in place of `now: this.#now`), and the one `GLOSSARY.md` "Elapsed time" sentence the brief names. No other wave-117 row owns `daemon.ts`.

## Type change

`LintIdleOptions`: `now: () => EpochMs` removed, `clock: Clock` added (required). Its one caller is the daemon. `LintPauseOptions` unchanged.

## Tests

`test/lint/pass/idle.test.ts`, "the continuous quiet across a calendar step (011-382)", on the virtual clock, quiet 3 s:
- set back 1 h, 1 s after the edit: 2,000 ms left, 1 ms left at 1,999 ms more, 0 at the end. Before the fix: 3,602,000.
- set forward 1 h: the same. Before the fix: 0 (the quiet was skipped).
- an edit after a step counts from its own stored time (3,000 ms).
The earlier cases (no step) keep their numbers: behaviour without a step is unchanged.

## Checks run (2026-11-16)

See the final report; recorded here: lint, typecheck, `key-format` 12/12 without a raise, direct `vitest run` of `test/lint/pass/idle.test.ts` (6/6) and `test/scheduler/one-loop-source.test.ts` (2/2). Load average 25 to 29 on 24 vCPUs (other coordinators' work).
