# 011-221 notes: the scheduler's model covers slow lanes and holds

Worker 0476a824, 2026-10-26. Wave 46 W3. Row 011-221, split from 011-211.

## Cause

011-195's model declared no slow file of spec 004 D1 and no hold event. So `SlowRelease`, row 011-211's close path, never armed in the model, and no invariant read a slow lane's instance (`tasks/011-211/notes.md`, "Decisions").

## What changed

- `test/scheduler/model-fixture.ts`:
  - `Plan.slowLane` (optional) adds `E2E`, two files under `e2e/**` that read `src/x.ts`, in the slow lane. `SLOW_POLICY` has `quietMs: 0` and `maxParallel: 1`, so each slow tier holds one file and fast work can come between two tiers of one pass. The slow tier gets its own slot directory, `load: () => [0]` and `cpus: () => 8`, so the load guard never waits.
  - Events `hold` (a command-hold entry, bounded by `ms`, held by the test process, so only its bound or `unhold` ends it) and `unhold` (every entry removed). Both call `scheduler.commandHold()`, as the daemon does at a hold or resume request. `drain()` ends the holds first, so invariant E stays reachable.
  - The runner gets `releaseLane`. `Model.open` holds the slow lanes whose instance a run opened and no `releaseLane` closed since. `Model.closedUnderRun` lists each close that came while a run of its lane was live.
  - `slowPlan(seed)` is a new generator. `plan()` and `backlogPlan()` are unchanged, so the earlier seeds play the same sequences.
  - In a `slowLane` plan, the `node` kind sets `backlogSlot: () => 1`, as the real node:test adapter does (`src/core/daemon/node-test-runners.ts:65`). Without it the scheduler treats every node tier as cancellable, so a hold cut the slow run and the "runner that does not cancel" order of 011-211 was not reached. Earlier plans keep 011-195's node kind.
- `test/scheduler/model-scheduler.test.ts`:
  - Invariant G, read at each quiet point:
    - no slow lane is open under a hold unless a run of it is live;
    - none is open 60 s after the last slow run with no run of it live;
    - no `releaseLane` comes while a run of its lane is live;
    - after `released()`, no lane is open (004 D2).
  - The last slow end is the model's clock at the first quiet point after it. That is no earlier than the scheduler's own `SlowTier.endedAt`, even when a `cross` jump comes inside the record.
  - Six directed sequences (three closes, each with `vitest` and `node`) and slow-lane seeds 1 to 8.
  - The G case also asserts that the sequences reached both closes with no slow run's end at that event: one under a hold and one at the bound. So a G that never meets its case fails.
- `test/scheduler/model-clock.ts`: unchanged.

## Evidence

The model test with the change, run directly at load 10.22 on 24 CPUs (`npx vitest run test/scheduler/model-scheduler.test.ts --reporter verbose`): 7 passed, 15.96 s, of which 14.4 s is the first case (it plays every sequence).

Squeal at revision 9 and again at revision 13 (`squeal status --wait 60000 test/scheduler/model-scheduler.test.ts test/scheduler/model-fixture.ts`): no known failures, each with a current result.

Three deliberate breaks of 011-211's close path, each reverted at once inside `squeal hold` (script in the run's scratch directory, `t/0476a824/breaks/run.sh`). Each run is `-t "G:"`:

1. `commandHold()` without `await this.#slowRelease.idle()` (`scheduler.ts:532`): G fails. "a hold begins with x2 queued and no slow run, node, event 6: slow: open under a hold, no run of it live". With `vitest` the pump's `held` branch closes the lane after the hold's cancel ends the fast tier, so only the node order shows it.
2. `SlowRelease.arm()` returns at once: G fails. "the bound passes with x2 queued behind fast work", both kinds, "event 7: slow: open 60 s after the last slow run, none live".
3. `idle()` without its in-flight filter (`slow-release.ts:59`): G fails. "a hold begins while x1 runs, node, event 5: slow: closed under its run", and slow-lane seeds 1, 7 and 8.

After the reverts `git diff -- src` is empty.

## Decisions the spec did not settle

- Slow-lane files only in new plans. Mixing them into `plan()` would change every earlier seed's sequence and the `slot` index of `end` and `finish`.
- G does not fail on an early close. The row asks for a skipped hold close and a close under a run.
- The holds are command holds only. The merge hold has the same pump path (`#holdCheck`), but it needs a conflicted index in the fixture repository.

## For whoever continues

- `model-fixture.ts` is 510 lines and `model-scheduler.test.ts` is 469, both over the styleguide's 300. They were 395 and 356 before. A split along fixture (`Model`) and plans (`plan`, `backlogPlan`, `slowPlan`) would be the natural cut.
- Breaking `src/` and reverting it under `squeal hold` queued 364 test files when the hold ended. They read `scheduler.ts` and had no result at their key in this worktree, because the baseline is lookup-only. The revert does not take them out of the queue. I stopped this worktree's daemon (`squeal stop`) so that they did not run. A start may resume that queue (011-33).
- Squeal's selection for `model-fixture.ts` named two test files at revision 9 (the model test and `test/version-sensitive.test.ts`) and one at revision 13. This is row 011-233's subject.

## Commits

- `e43087461` test(011-221): the scheduler's model runs slow-lane files and holds; invariant G
- this notes file and a comment fix, in the next commit
