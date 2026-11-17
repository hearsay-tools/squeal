# 011-386: the yield and pool-wait rows across a calendar step

Wave 117 W2, worker ede0d6d2, 2026-11-16. Brief: `tasks/wave-117.md`, "W2: row 011-386". Base: main `161b1ed9f` (0.1.526).

## Change

Both rows now use the stamp row 011-377 gave the quiet and promotions rows (`CalendarSteps.stamp`: the reading, never before this daemon's stored start). No row shape change; the readers (`readYieldRow`, `publishedPoolWaits`) are unchanged.

- Yield row: `TierYields.#publish` (`src/core/scheduler/yields.ts`) stamps through `context.steps?.stamp(at) ?? at`. Every write goes through `#publish` (check, `fileEnded`, `ended`).
- Pool-wait row: new `poolWaitsPublish(store, worktreeId, steps?)` in `src/core/scheduler/pool-wait.ts` returns the `PoolWaitsOptions.publish` callback, stamping through `steps.stamp`. The scheduler wires `PoolWaits` with it (`scheduler.ts`), so the test exercises the same wiring as production. A predecessor's or successor's daemon record never matches the scheduler's incarnation (`#daemonStartedAt`), so a predecessor's late row keeps its own earlier start and is still rejected.

## Tests

`test/scheduler/calendar-steps-rows.test.ts` (new; the B1 shape of `calendar-steps-seams.test.ts`): owner to public reader, a real daemon record in a real store.

- The yield row (`TierYields.fileEnded`, a two-file tier with one ended file) reads as the live daemon's after a set-back and a set-forward of 1 h (`publishedYieldRow`).
- The pool-wait row (`PoolWaits.refused` wired with `poolWaitsPublish`) reads as the live daemon's after both steps (`publishedPoolWaits`).
- A predecessor's rows, written after its successor started with the calendar set back first, are stamped with the predecessor's start and rejected by both readers.

Red before: the yield row set-back case and the predecessor case failed before the `yields.ts` change (`expected undefined to be 10000000`). Mutation: `poolWaitsPublish` without the stamp fails the pool-wait set-back case and the predecessor case. The set-forward cases passed before too: a forward step only makes the stamp later.

## Effects and limits

- After a set-back past the daemon's start, the rows' `at` is the daemon's start, not the reading. The one place status shows it: the named file-end line, "as of <time>" (`standing-yields.ts` `asOf`, `cli/named-file-end.ts`). Same accepted trade as the quiet and promotions rows (row 011-377, design A).
- Not changed, noticed: `PoolWaits` keeps its own times on the calendar (`since`, `last`, `#publishedAt`) and has no step listener. After a set-back the row's refresh (`POOL_WAIT_REFRESH_MS`) waits until the calendar passes the last write again, so status shows the gate of the last write before the step for up to the set-back; the row stays fresh for status (its `at` is ahead of the reading). After a set-forward past `SLOT_WAITER_FRESH_MS`, the next refusal starts a new wait (a new log line and a new `since`). Neither hides a live row. If wanted, a coordinator row can move these to elapsed time.

## Type changes (additive)

- `poolWaitsPublish(store, worktreeId, steps?)` exported from `pool-wait.ts`. `publishPoolWaits` is now used only through it in `src/`.
