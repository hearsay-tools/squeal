# 011-353: the model test on the virtual clock

Worker 7a90f9aa, wave 99 W1, 2026-11-15. Base: f8d196991, then rebased onto d77d1f9d8 (held-run repair) and 2c5217c9f (slot-gather repair, fix c2748ae96) on cand/0.1.513.

## What changed

- `test/helpers/virtual-clock.ts`: `virtualClock(start, { prompt })` and `jump(ms)`.
  - `prompt: true` fires a timer that is due (armed at 0 ms, or passed by a `jump`) once the host turns (`setImmediate`). Time does not move. Without it, `Scheduler.rest()` waits forever on a wake that an owner stated at or before now outside a pass: the wake loop arms a 0 ms timer, and on a plain virtual clock only `advance` fires it.
  - `jump(ms)` moves the reading and fires nothing inside it, as a host's clock that passes a deadline inside one decision. `advance` no longer moves time back to a passed timer's time (`now = max(now, due.at)`).
  - `CrossingClock` starts at the host's time at its first reading, as `ModelClock` did. When it started at construction, `batch-line.test.ts` 7 and `promoted-tier-expiry.test.ts` failed: those fixtures read standings with `Date.now()` against the scheduler's still clock, so their setup time counted.
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

## Second gap: the slot gather (fixed in c2748ae96)

On d77d1f9d8 (the held-run repair), all 7 cases still failed. A temporary debug line (reverted) showed the drain's settle with no live run, 6 tracked works, and the only stated wake slot-gather 25 ms ahead. The cause: a flight's record awaits `SlotRecords`' gather wait (`slot-records.ts`, `await this.#gathering`) inside tracked work, and that wait is not set aside. On a virtual clock it fires only on `advance`, so `rest()` never comes. The old `ModelClock` hid this: it also fired every timer at its real delay. Proposed to the coordinator: `await this.#wakes.aside(this.#gathering)`. Locally, with it, the model test passed 7/7 in 14.3 s at load 6.6.

## Model test run

On 2c5217c9f, 2026-11-15 14:29Z: `env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run test/scheduler/model-scheduler.test.ts`. Result: 7 of 7 passed. Vitest duration 16.2 s; wall time 16.7 s. One-minute load 7.9 at the start and 8.6 at the end, on 24 CPUs. The run before this row took 18 to 30 s. Most of the time left is the real store and git fixture work per sequence; the clock no longer adds 1 ms sleeps and 4 ms quiet windows to every event.

The plans played are unchanged (`model-scheduler.test.ts` is not edited):

- Directed: "F's reproduction", "R398's shortest", "R427's hand sequence", "seed 173 vitest", and the laned sequences "a hold begins with x2 queued and no slow run" and "a hold begins while x1 runs", each for vitest and node.
- Seeds: `plan(1..24, 60)`, `backlogPlan(1..6)`, `slowPlan(1..8)`.
- Sweeps: "seed 60's shape" and "an earlier wait's deadline", a jump at readings 0 to 15. A sweep stops at the first reading that the scheduler does not take.
- Properties A to G as before.

What the virtual clock changes in meaning:

- A `step` now fires every timer due on the way, in order, at its own time. Before, the timers passed fired on the next real turn, all at the end time, plus a `requestRetries()` nudge. The pump's waits and the claims poll now fire as owners stated them, with no nudge.
- A `cross` jump fires the timers it passes on the next host turn (`jump` plus `prompt`), as before. The number of readings in a sweep can differ from before, because the scheduler now reads only its own clock. I did not count the sweep length per run.
- A quiet point is `Scheduler.rest()`: nothing tracked, no lock task, no wake due. Before, it was 4 ms of no new tracked call on real time. A record's slot gather is a stated wake now. It fires only when the model moves time: a `step`, a `drain`'s 60 s, or a jump.

## For the next worker

- Other test files can move to `clock: "virtual"` with `await h.rest()` in place of polls and real sleeps. Keep `prompt` on: without it, `rest()` can hang on a due wake.
- `rest()` counts a held run as rest only once the repair lands. Until then, a test that holds a run cannot settle with it.
