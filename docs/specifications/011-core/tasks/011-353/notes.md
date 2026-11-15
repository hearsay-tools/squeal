# 011-353: the model test on the virtual clock

Worker 7a90f9aa, wave 99 W1, 2026-11-15. Base: f8d196991 (cand/0.1.513 rows 011-351 and 011-352).

## What changed

- `test/helpers/virtual-clock.ts`: `virtualClock(start, { prompt })` and `jump(ms)`.
  - `prompt: true` fires a timer that is due (armed at 0 ms, or passed by a `jump`) once the host turns (`setImmediate`). Time does not move. Without it, `Scheduler.rest()` waits forever on a wake that an owner stated at or before now outside a pass: the wake loop arms a 0 ms timer, and on a plain virtual clock only `advance` fires it.
  - `jump(ms)` moves the reading and fires nothing inside it, as a host's clock that passes a deadline inside one decision. `advance` no longer moves time back to a passed timer's time (`now = max(now, due.at)`).
  - `CrossingClock`: the model's clock (was `model-clock.ts`'s `ModelClock`), a prompt virtual clock with `cross(reads, ms)` / `uncross()` / `crossed` / `raw()`. The jump is a `jump`, so its timers fire on the next host turn, as the old clock's `realSetTimeout(0)` did. Firing them inside the `now()` reading would re-enter the wake loop's pass.
  - `harnessClock(clock, now)`: the two harnesses' clock option. `"virtual"` gives a prompt virtual clock from `Date.now()`. A `VirtualClock` is used as given. Absent, the host's clock over `now` plus `advance` (the old `movableClock`).
- `catch-up-fixture.ts` and `vitest-harness.ts`: `clock?: "virtual" | VirtualClock`. The side/harness gains `clock` (`null` on the host's) and `rest()` (`advance(0)` then `scheduler.rest()`). The default is unchanged.
- `model-fixture.ts`: the scheduler gets `clock: CrossingClock` through `catchUpSide`. `#settle` is `side.rest()` with a 20 s guard. `drain` settles with `rest()` and advances 60 s, with no `requestRetries()`. A `step` is `clock.advance(ms)`. The drain-mode run ends on `setImmediate`. `close` keeps its 20 s guard. `watchWork` and its four prototype wraps are gone.
- `model-clock.ts` deleted. `batch-fixture.ts`, `promoted-tier-fixture.ts`, `tier-yields-named.test.ts` and `tier-yields-next-tier.test.ts` change only their import line to `import { CrossingClock as ModelClock } from "../helpers/virtual-clock.js"`. This follows the coordinator's reply d650443f (option B). They use it as a still `now`, as before.
- `model-harness-clock.test.ts` (new, 5 cases): prompt fire, jump order, no prompt, crossing count, a catch-up side on `"virtual"` that rests after its baseline.

## Scoped grep (scope accepted by the coordinator)

```
$ grep -rn "realSleep\|realSetTimeout\|watchWork\|requestRetries\|model-clock" test/scheduler/model-*.ts test/scheduler/catch-up-fixture.ts test/scheduler/vitest-harness.ts
(nothing; exit 1)
$ grep -rln "model-clock" test src
(nothing; exit 1)
```

`requestRetries` in the retry tests and `busy-record.test.ts`'s own `realSetTimeout` stay (the coordinator's reply).

## Blocker found

The 011-352 review found the same blocker: `Scheduler.rest()` stays pending while a runner run is held. Every model plan holds a run: `Model.start` leaves four slow files of an edit's tier in flight. So all 7 cases failed with "no quiet point in 20000 ms" at the start's settle (22 s, load 6.2 on 24 CPUs, before the repair). A minimal case is in the progress message to the coordinator: a held `catchUpSide` runner, an edit, then `rest()`.

## Model test run

(after the repair: wall time, the one-minute load, plans and seeds)

## For the next worker

- Other test files can move to `clock: "virtual"` with `await h.rest()` in place of polls and real sleeps. Keep `prompt` on: without it, `rest()` can hang on a due wake.
- `rest()` counts a held run as rest only once the repair lands. Until then, a test that holds a run cannot settle with it.
