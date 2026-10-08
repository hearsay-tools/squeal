# 001-140 notes: lanes

003 `lessons.md` defect 2: at r4 the edit touched only node:test files; their run started 4 min 17 s later, behind a 425 s Vitest tier of r2, and until then even the runner part stayed pending.

## What serialized the work, before this row

1. **The scheduler pump** (`scheduler.ts` `#pump`): one loop that drained `RunnerWork` only between tiers and ran one tier at a time (`#running: Tier | null`).
2. **`VitestAdapter.#serial`** (`src/runners/vitest/adapter.ts`): `invalidate`, `affected`, `closure`, `enumerate`, `testFiles`, `environment` and `run` share one queue, so every runner-part call waits for a Vitest run in flight.
3. **The composite** (`src/core/daemon/composite-runner.ts`): `invalidate` and `affected` fan out with `Promise.all` to every adapter, so a node:test-only revision's runner part waits for (2) as well. Its `run` runs the parts of one call one after another; two calls run at once.
4. **`afterEachRun`** (`src/core/daemon/escaped.ts`, 001-142): stopped every `SQUEAL_DAEMON_CHILD` carrier started since a run began, once that run settled. Harmless with one run at a time; with two it would stop the other run's workers.

The ledger was not a serializer in itself, but two pieces of per-tier state lived on it as singletons: `Ledger.tierChanges` (revisions during the tier) and `WorktreeKeys.#firstHashed`, reset by `beginRun` (001-134's first-seen evidence). A second tier's start would have wiped the first one's.

## What this row changed

- **Lanes.** `RunnerAdapter.lane?(testFile)`, additive; the composite answers with the owning adapter's `name` (`vitest`, `node-test`; every node:test project shares one lane). `laneOf` in `tiers.ts` defaults to `""`, one lane.
- **Pump** (`scheduler.ts`): a planner loop. Per pass: start draining runner work (`#drain`, beside the tiers in flight); while it drains, wait. Else, if tiers are in flight and no queued fast file has a free lane, wait (so the install check stays a check before a tier, never during one: `test/scheduler/reinstall.test.ts`). Else install check, then `selectTier(context, ledger, busyLanes)`; a tier is launched with `#fly` and the loop tries the next lane. With nothing selectable and nothing in flight, the slow tier is asked as before; else wait. Events (`#notify`): a tier ended, the drain ended, `#pump()` called while pumping, close. `#woken` guards against a notify lost during the pass's awaits.
- **Per-tier state:** `Tier.lane`, `Tier.run` (`beginRun()` now returns a number; `firstHashedDuringRun(path, run)`), `Tier.changes` (registered in `Ledger.tierChanges`, a set of sets). `endTier` unregisters once, from `recordTier` or `#requeue`.
- **Selection:** a tier holds files of one lane, the first file's in D5 order; files of busy lanes are skipped before the store lookup; backlog-ness is decided on free lanes' files (`RunQueue.hasRecent(where)`), and `cancelsBacklog` looks at recent work in the tier's own lane.
- **Slow tier:** consulted only with no tier in flight, so spec 004's rules are untouched; a fast tier of another lane may start beside a slow file.
- **`afterEachRun`:** counts runs in flight; the stop happens when the last settles, looking back to the first one's mark.

Tests: `test/scheduler/lanes.test.ts` (both proofs below), `test/daemon/escaped-overlap.test.ts`, the lane case in `test/daemon/composite-runner.test.ts`. Two tests changed their expectation because the runner part now starts beside the tier: `revision-lag.test.ts` (the first invalidate is called during the tier and waits in the adapter) and `runner-work.test.ts` (at close, the runner part begun beside the tier is applied; the work queued behind it is dropped).

`lanes.test.ts` proves two things. With a Vitest stand-in whose other calls do not wait for its run (`HarnessOptions.runnerPartBesideRun`, what slice (c) will give the real adapter): the older revision's Vitest tier is held, the newer revision changes only `nt/src/a.mjs`, and its runner part lands, its node:test file runs and its `fail` is stored before the Vitest tier ends. With today's serialized adapter: one revision reaching both lanes runs the node:test tier beside the held Vitest tier.

## Remaining slice (c): the Vitest adapter's runner part during its run

Not done here (001-146 is in the same adapter). Until it lands, while a Vitest tier runs, every revision's runner part waits for it, a node:test-only one included, so cezar's r4 still waits for the runner part; what this row gives is that once the runner part lands, the node:test tier no longer waits for the Vitest tier.

What must still exclude a run, and what need not (Vitest 5.0.3, `node_modules/vitest/dist/chunks/index.DpLw24bj.js`):

- **A recreate** (`#recreate`: `close()` then a new instance) must wait for the run and block the next one: it closes the instance the run uses. `invalidate` decides it before any work (`recreateTriggers`, the lockfiles), so only that branch needs the run lock.
- **`run` against `run`**: Vitest serializes runs itself (`runningPromise`); keep one queue for runs.
- **`invalidateFile`** during a run is what Vitest's own watcher does (`onFileChange`, line ~20310: invalidates at once, schedules the rerun after the running one). Safe; the stability check discards a run that read a changed input.
- **`config.related`** is the one shared field: both `runTestSpecifications` and `rerunTestSpecifications` set `config.related = void 0` in their `finally` (lines ~21153 and ~21269), and `filterTestsBySource` reads `config.related` only after `await this.globTestSpecifications(filters)` (line ~18592). So a related walk (`related.ts`) overlapping the end of a run can lose `related` mid-walk and get every spec back: an over-run, never a missed file, but every test file transitive. Fix options: hold the related walk on the run queue only for its `config.related` window, or pass the related set without the shared field.
- **`closure`, `enumerate`, `testFiles`, `environment`**: transforms and parses through the project's Vite server, which serves concurrent requests during a run; `environment` reads the resolved config. No shared mutable field found; a recreate must still exclude them.
- **`#observer.stale()`** recreates inside `#serial`; it belongs with the recreate branch.

## For 004-18 (a separate lane for slow files)

Reuse, do not rebuild:

- **The lane is the unit**, not the runner instance or the tier: `RunnerAdapter.lane(testFile)` names it and the scheduler keeps `#inFlight: Map<lane, InFlight>`, one tier per lane. A slow lane is a lane name for slow files, for example `lane = isSlow(ref) ? "slow:" + runnerLane : runnerLane`, decided in `laneOf` (scheduler side, from `slowView`), with the slow lane's runner the second Vitest instance of 004 D2. The runner owns an instance for the length of a tier through its own serialization; the scheduler only promises not to start a second tier in a lane.
- **`#fly(tier, stamp, slow)`** already carries a `SlowRun` and releases its slot; a slow tier is launched the same way as a fast one.
- **The gate to lift** is in `#pump`: the slow tier is consulted only when `#inFlight.size === 0`. With a slow lane, ask `#slow.next()` when the slow lane is free and spec 004's trigger holds, beside fast tiers; `fastPending` stays the precedence rule.
- **Per-tier evidence** (`Tier.changes`, `Tier.run`, `endTier`) and the install check before a tier (`#freeLaneQueued`) already hold for any number of lanes.
- **`afterEachRun`** stops leftovers only when the last overlapping run settles; with a slow lane that can hold leftovers of a short fast tier for a whole slow file. D12 records that 004-18 replaces it with a mark per lane (`SQUEAL_DAEMON_CHILD=<daemon>:<lane>`), and `RunOptions` would need to tell the adapter the lane so its workers carry it.
- **Cap:** one tier per lane, each with its runner's workers. A slow lane adds 004's `slow.maxWorkers` (default 2) beside the fast lanes.
