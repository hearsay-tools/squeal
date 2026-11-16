# 011-378: a test-only quiet point that also sees runner work

Worker 312a691f, wave 113 W1, 2026-11-16. Base: `4accbca09` (main at 0.1.523 plus docs). Shape: slice. Test files only; no `src/` change (the coordinator's decision, survey option 1).

## The quiet point's contract

`test/helpers/quiet-point.ts`, with its test `test/helpers/quiet-point.test.ts`.

- `RunnerCalls` counts the runner calls the scheduler has open: `run`, `affected`, `closure`, `enumerate`, `environment`, `invalidate`, `recheck`, `testFiles`, `globalSetups`, `releaseLane` (every call but `close`). `mark()` changes at each call's start and end; `describe()` names the open calls for an error.
- `countCalls(runner, calls)` returns `runner` with those calls counted. It reads each call from `runner` at call time, so a test that replaces `runner.run` or a part's call after the build is still counted (`lane-setup.test.ts` routes runs to a remote lane this way). A call the runner lacks stays `undefined`, so `runner.recheck === undefined` checks in `src/` read as before.
- `quiet(side, options)`:
  1. `side.rest()`.
  2. A call it waits for is open: wait for a call to end, then rest again. It waits for every open run, and for open runner-part calls while the rest names a `runner-part-bound` wake. The scheduler bounds each runner-part call it makes with such a wake (`RunnerPartBound`); an open call with none left is past its bound and abandoned, and `idle()` did not wait for it either. `edit-cut.test.ts` case 7 holds such a call open for good and timed out (120 s) until this rule.
  3. On a virtual clock, a record's gather (`slot-gather`) that no other wake comes at or before: move the clock to it and rest again (`gatherAt`, the rule `settle` has had since row 011-368). It moves the clock to nothing else.
  4. On the host's clock, a wake `options.through` names, or a gather, is left: look again after 20 ms of real time. `Scheduler.idle()` waited for these in real time; a test names the ones it needs (`"claims"`, `"pump"`).
  5. One real timer turn; no call open and the mark unchanged since before the rest: return the rest.
  6. A 120 s host-clock guard (`QUIET_LIMIT_MS`, or `options.limitMs`) fails the test with the open calls and the wakes left.
- A call the test holds open (a held run) holds the quiet point until it ends, as it held `idle()`. Such a test reads `rest()`, or `settle` for catch-up sides (below).

Why gathers are always waited through on the host's clock (a decision the brief did not settle): `pytest-slots.test.ts` (pilot) failed its packing check when the quiet point returned before the backlog record's gather: the durations the second pass packs by were not stored yet. On a virtual clock the quiet point already moves time to a gather, so this keeps one rule on both clocks: a gather is bookkeeping, not a wake the test drives.

Why `through` (also not in the brief): `claims-split.test.ts` (pilot) failed (90 of 120 runs) when each of four sides returned at its rest while files waited for another side's claim. `idle()` waited through the claim rechecks in real time. The survey's class B assumes no timed wake is left; on the host's clock this depends on timing, so a single probe run can call a file B that sometimes needs a wake waited for. `through` lets a host-clock file say which wake it waits for, instead of moving to a virtual clock.

## Builders

Each wraps the runner it hands `createScheduler` in `countCalls` and offers `calls` and `quiet(options?)`:

- `test/scheduler/vitest-harness.ts` (`Harness`): wraps `schedulerRunner`, so every part behind the composite is counted (Vitest, node:test, pytest, `adapters`).
- `test/scheduler/node-test-harness.ts`: no change; it builds through the Vitest harness.
- `test/scheduler/catch-up-fixture.ts` (`CatchUpSide`): wraps `wrapRunner(runner)` when given, else the fake runner.
- `test/scheduler/claims-fixture.ts` (`Side`): the fake runner; `daemon-kit.ts` builds on it.
- `test/scheduler/fresh-worktree-durations.test.ts`: its own `daemonAt` builder, changed because `drive-fixture.ts`'s `Driven` now needs `quiet` (an A1 file of row 011-379; the change is the builder only).

`settle` (`tier-yields-fixture.ts`) now reads `side.calls.mark()` instead of `CatchUpRunner.runs`, so a run routed past `runs` is seen; it still returns with a held run in flight. `gatherAt` moved to `quiet-point.ts`, shared by both. `tier-yields-settle.test.ts` builds its fake side with a `RunnerCalls`.

Not done here: the other builders of row 011-380 B7 (`slots-fixture`, `preload-worktrees`, the daemon loop, files that call `createScheduler` themselves). Each takes `countCalls` plus `quiet` as above, about 5 lines.

## The 14 fixtures

`idle()` → the quiet point at each site:

| Fixture | Sites | Now |
|---|---|---|
| `test/ci/export-harness.ts` | 1 | `h.quiet()` |
| `test/integration/touched-repo.ts` | 2 | `h.quiet()` |
| `test/scheduler/backlog-quiet-fixture.ts` | 1 | `side.quiet()` (host clock) |
| `test/scheduler/batch-fixture.ts` | 1 | `side.quiet()` on the host clock; `settle` on a virtual one, as before |
| `test/scheduler/crash-rekey-fixture.ts` | 3 | `h.quiet()` |
| `test/scheduler/drive-fixture.ts` | 1 | `idleOn`: the quiet point, moving the clock to each `DRIVEN` wake, until none is next; returns that rest. `Driven` drops `scheduler: Pick<Scheduler, "idle">` (row 011-371 D) and needs `quiet` |
| `test/scheduler/edit-cut-fixture.ts` | 1 | `side.quiet()` on the host clock; `settle` on a virtual one |
| `test/scheduler/forced-requeue-fixture.ts` | 2 | `h.quiet()` |
| `test/scheduler/model-fixture.ts` | 1 | `drain`: complete live runs, the quiet point, done when no run is live and no wake is left, else 60 s on; at most 300 rounds |
| `test/scheduler/promoted-tier-fixture.ts` | 1 | `side.quiet()` |
| `test/scheduler/quiet-clock.ts` | 1 | `idleAfterQuiet`: the quiet point; skip a wait before catch-up and look again; on the host clock wait while the pump's own wait is left; `Clocked` needs `clock` and `quiet` |
| `test/scheduler/retry-fixture.ts` | 2 | `h.quiet()` |
| `test/scheduler/warm-up-repo.ts` | 1 | `h.quiet()` |
| `test/shared/daemon-kit.ts` | 2 | `a.quiet()`, `d.quiet()` |

`group-lanes-fixture.ts` and `wall-fixture.ts` stay for row 011-379 (A1), as the survey says.

Changed in meaning: `model-fixture.ts` `drain` and `drive-fixture.ts` `idleOn` now end on "no wake left" (`drain`) or "no driven wake next" (`idleOn`) instead of the scheduler's private "no admitted work". `drain` is stricter (it also passes a slow instance's release, say); `idleOn` leaves a non-driven wake for the test, as `until` always did.

## Pilot

Five class-B files across four builders:

| File | Builder | Sites | Note |
|---|---|---|---|
| `test/runners/vitest/setup-failure.test.ts` | Vitest harness | 6 | |
| `test/integration/touched-scope.test.ts` | node:test harness | 3 | |
| `test/scheduler/pytest-slots.test.ts` | Vitest harness + pytest adapter | 2 | needed the gather rule |
| `test/scheduler/tier-yields-ended.test.ts` | catch-up | 3 | |
| `test/scheduler/claims-split.test.ts` | claims | 2 | needed `through: ["claims"]` |

RUNS_PLACEHOLDER
