# 011-389 notes: the pool's wait keeps its times on elapsed time

Worker 36ba3ab8, wave 118 W1, 2026-11-17. Shape: slice.

## Change

- `PoolWaitsOptions.elapsed?: () => number` (additive). Without it, `PoolWaits` reads `now`, so every caller without it behaves as before.
- `PoolWaits` keeps each lane's last refusal (`last`), its start (`began`, new) and the last write (`#publishedAt`) in elapsed time. Freshness (`SLOT_WAITER_FRESH_MS`), the 10 s refresh (`POOL_WAIT_REFRESH_MS`) and the grant's seconds count elapsed time.
- `since` and the row's `at` stay calendar times. The row's shape (`{ at, lanes }`, each `PoolWait`) and its readers are unchanged.
- A refusal writes the row again when `calendar - elapsed` moved by at least `CALENDAR_STEP_MS` since the last write. Without it, after a set-forward the row's calendar `at` read stale to status (`publishedPoolWaits`: `now - at > SLOT_WAITER_FRESH_MS`) until the next 10 s refresh. Without a calendar step the offset does not move, so no extra write.
- `scheduler.ts`: one line, `elapsed: this.#clock.elapsed`, in the `PoolWaits` wiring. Outside the brief's named ownership (pool-wait.ts and tests), but the only seam that gives the owner elapsed time; no other change there.

Design choice: elapsed time, not a step listener that moves kept times (row 011-377's other route). The owner only needs differences, and the scheduler's clock already gives elapsed time; a listener would need `CalendarSteps` passed in as well.

## Tests

`test/scheduler/calendar-steps-rows.test.ts`, "row 011-389", on the virtual clock with `shiftCalendar`, the owner wired as the scheduler wires it (`steppedClock`, `poolWaitsPublish`, a live store):

- 1 h set-back: the first refusal after the step writes its gate; a changed gate 10 s of elapsed time later is in the row; `since` and `at` are the daemon's start; the grant logs 14 s. Before: the old gate stayed, the grant logged negative seconds.
- 1 h set-forward: the next refusal goes on with the same wait (one start line), the row reads live at once, the grant logs 12 s. Before: a new wait started.
- A 31 s elapsed gap with a 1 h set-back is still two waits. Before: the set-back hid the gap and kept one wait.

All three failed on the base code (red commit, then the fix stashed and the file run again). `test/scheduler/pool-wait.test.ts` (no `elapsed`) is unchanged and passes.

## Limits

- `since` after a set-back is ahead of today's calendar, as the brief keeps it a stored calendar fact; status text that subtracts it from `now` shows a short or negative age until the calendar passes it. Not changed here; the grant line no longer uses it.
- The row's `at` after a set-back past the daemon's start is the start (row 011-386 stamp), unchanged.
