# 011-390 notes: the pool's wait takes its step from the scheduler's sample

Worker 58724cf5, wave 120 W1, 2026-11-17. Shape: slice.

## Change

- `PoolWaitsOptions.steps?: Pick<CalendarSteps, "total">` (additive). `PoolWaits` keeps `steps.total` at each write (`#publishedSteps`, which replaces `#publishedOffset`) and writes the row again at a refusal when `total` changed since. Without `steps`, no step rewrite; only the scheduler passes `elapsed`, and it passes `steps` too.
- `scheduler.ts`: one line, `steps: this.#steps`, beside row 011-389's `elapsed: this.#clock.elapsed`.
- Refresh, freshness and the grant's seconds stay on elapsed time. Row shape, readers, status and log text, keys: unchanged. No new threshold; `CALENDAR_STEP_MS` is no longer imported here.

## Which source of the step, and why

The scheduler's `CalendarSteps`, not a bracketed sample inside `PoolWaits`.

- `PoolWaits.now` is the scheduler's stepped clock (`steppedClock`). Each `now()` reads elapsed, calendar, elapsed and calls `CalendarSteps.observe`, which leaves out a sample wider than `SURE_SAMPLE_MS` and tells a step only at `CALENDAR_STEP_MS` or more. `refused` reads `now()` before it reads `steps.total`, so a step this very reading saw is already counted.
- A second bracketed sample in `PoolWaits` would be a third copy of the rule, which the brief and review 0.1.531 ask to avoid. Reading `total` needs no listener, so nothing to unsubscribe.
- A step told by any other calendar reading of the scheduler between two refusals also counts, which is right: the row's `at` was written on the old calendar.

## Tests

`test/scheduler/calendar-steps-rows.test.ts`, "row 011-390": the review's probe as an owner test. Both clocks advance 200 ms between the calendar and the elapsed reading, no `shiftCalendar`; one start write stays until the 10 s refresh, which then writes. Red before the fix with writes `[10000000, 10002000, 10004200]` (the review's numbers), green after. The row 011-389 tests (1 h set-back, set-forward, 31 s gap) are unchanged apart from the shared helper passing `steps`, as the scheduler does, and pass.

## Limits

- A step the stepped clock leaves out as unsure is not told here either; the next sure sample tells it, as for every other owner (row 011-377).
- A `PoolWaits` built with `elapsed` but without `steps` never rewrites on a step; no caller does that.
