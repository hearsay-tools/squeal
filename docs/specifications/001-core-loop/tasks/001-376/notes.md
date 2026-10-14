# 001-376: one per-user permit pool for every lane

Worker notes, 2026-10-14. Spec 001 D11 Capacity (decided 2026-10-14), `research/host-capacity.md` 4B.

## What landed

- `src/core/capacity/` (new):
  - `share.ts`: `fairShares(hostSlots, demands)`. Max-min fair division (water-filling): a daemon that wants less than an equal share gets its want, and the rest is divided again among the others. A capped project's daemons are first divided the project's slots the same way. What an equal division leaves over goes one slot each to the longest waiters. Every share is at least 1, the free worker.
  - `marks.ts`: one mark per daemon, `pool.mark.<sha256(worktreeId)[:16]>`, JSON `{v, id, want, grant, since, project}`. It is written beside the old one and renamed over it, so a reader never sees half a mark. `readMarks` returns the other daemons' marks younger than `SLOT_WAITER_FRESH_MS` (30 s).
  - `pool.ts`: `createPermitPool({ dir, owner, hostSlots?, project?, now?, refreshMs? })`, giving `acquire(want) → PoolLease | null` and `close()`, plus `defaultHostSlots()` (CPUs − 1, at least 1).
- `src/core/slow/slot.ts`: `takePermit` is exported, with no other change. Pool permits are the same SQLite exclusive locks: `pool.<i>.lock` in the slow slot's directory.
- `src/core/scheduler/capacity.ts`: `TierCapacity`, the scheduler's side of the pool. A pool that throws (directory refused, or gone) does not stall the scheduler. The tier runs without a grant, and one note says why. The note is not repeated until the reason changes.
- `src/core/scheduler/tiers.ts`, `selectTier`: a backlog tier takes its lease after its files are picked and before `startTier`'s `BEGIN IMMEDIATE` marks keys `running`.
  - `startTier` shrinks the lease to the files that actually start.
  - `endTier` releases it, and `#fly`'s `finally` releases it again (idempotent).
  - `executeTier` passes `RunOptions.workers = lease.grant`.
- `src/core/scheduler/scheduler.ts`: builds `TierCapacity` from `SchedulerOptions.capacity` and closes it after the pump.
- `src/core/daemon/daemon.ts`: `capacity: { dir: slowSlotDir(this.options.env), ...this.options.capacity }`, so every daemon is in the pool. `DaemonOptions.capacity?: PoolCapacity` is the injection point for 001-377.

## Type changes (all additive)

- `RunOptions.workers?: number` (`src/core/types/runner.ts`). Absent for an edit's tier and when there is no pool. No adapter reads it yet: that is 001-378.
- `Tier.lease?: PoolLease`. `startTier(..., lease?)` gained an optional fifth parameter.
- `SchedulerContext.capacity?: TierCapacity`, and `SchedulerOptions.capacity?: CapacityOptions` (`PoolCapacity & { dir, refreshMs? }`).
- `DaemonOptions.capacity?: PoolCapacity` (`{ hostSlots?, project?: { id, slots } }`).
- `HarnessOptions.capacity` in `test/scheduler/helpers.ts`. When it is absent, a scheduler test has no pool, so existing scheduler tests are unchanged.

## Decisions the spec did not settle

1. **Pool size: `hostSlots − 1` permit files, plus each daemon's free worker.**
   - A lone daemon runs `hostSlots` workers, today's 23 on 24 CPUs. n daemons that each keep to their share run at most `hostSlots` in total.
   - The lock files alone bound the total at `hostSlots − 1 + n`: each daemon's free worker is outside the pool, as make's implicit slot is.
2. **Who counts as "daemons with backlog work".** Every fresh mark counts.
   - A daemon refreshes its mark every 10 s while any lease is held. A live holder therefore always counts, whatever its age, as the spec says.
   - A dead holder's permits come back when it dies (OS lock release). Its mark keeps counting for up to 30 s, which is conservative for that short window.
   - A daemon's mark is cleared when its last lease goes. Between two tiers (record, then select) it is unmarked for a moment, and another daemon's boundary in that gap does not count it. The alternative, keeping the mark across the gap, leaves a finished daemon counted for 30 s at every other daemon's boundary, and each of those boundaries holds a share for a whole tier (up to 300 s). The short gap costs less.
3. **Waiter.** A daemon is a waiter from the first boundary where it got less than its entitlement until a boundary where it gets it all. Its `since` survives the gap between tiers and is forgotten after 30 s without a lease.
4. **Longest waiter first.** At a boundary a daemon leaves free what every older waiter lacks: that waiter's share minus its grant. To count what is free it takes up to `want + reserve` permits and returns the excess at once. A daemon that has its share ranks as "now", so every waiter is older than it.
5. **"Each daemon has one free backlog worker" is per daemon, not per lane.**
   - A second lane's backlog tier, started while the first holds the free worker, needs a permit.
   - With none free it does not start (`WAIT_FOR_CAPACITY`). `selectTier` commits and returns `null`, holding no claim.
   - The first lane's tier ending wakes the pump through `#notify`, so nothing polls.
   - Another daemon's release does not wake it, by design: the wait lasts at most that one tier of its own.
6. **Project cap.**
   - Shares first: the project's daemons divide `project.slots` by water-filling.
   - A hard check with no preemption: a daemon never takes past `slots − (what the project's other daemons hold) − (what it holds)`. The free worker is still always run.
   - The project id is whatever 001-377 passes. The spec says "repository root path".
7. **Edit tiers** never call the pool, so they hold no permit and no mark, and they carry no `workers`. Whether a tier is the backlog's is `selectTier`'s existing `backlog` flag: a tier picked while no queued file of a free lane is recent. Checkpoint and warm-up tiers are backlog tiers by that flag. A checkpoint's files picked while an edit's work is queued ride the edit's tier, as today.
8. **The slow lane keeps its own permits** (`slow.lock`, `slow.<i>.lock`, `slow.maxParallel`, load guard, waiter marks), unchanged. Slow tiers take no pool permit. See question 1.
9. **The pool directory is the daemon's `env`**, `slowSlotDir(this.options.env)`. The slow tier reads `process.env` instead. For a daemon started inside a test with a temporary `XDG_RUNTIME_DIR` in `env`, the pool follows that temporary directory. The slow lane's default is untouched.

## Questions for the spec (coordinator)

1. D11 says "the slow lane's lock files ... extended to every lane". Should slow tiers also count against `hostSlots`?
   - Today a slow tier is bounded by `slow.maxParallel × slow.maxWorkers` (4 × 2) and the load guard, beside the pool.
   - Proposed wording, if the answer is no: "Backlog and checkpoint tiers of the fast lanes take permits from one per-user pool, kept beside the slow lane's lock files in `$XDG_RUNTIME_DIR/squeal` (004 D2)".
   - Folding slow tiers in would change 004 D2's permits and is a separate row.
2. "Every daemon may always run one backlog worker without a permit." For a daemon with two lanes (Vitest and pytest), this row reads it as one free worker per daemon, so a second lane's concurrent backlog tier needs a permit or waits for its own first tier (decision 5). If the spec means one free worker per lane, the change is one line in `pool.ts` (`free` per lease rather than per daemon).

## Evidence

- `test/capacity/share.test.ts` (5 tests):
  - a lone daemon takes every slot;
  - an equal split with the remainder going to the longest waiter;
  - unused slots go to the others;
  - every daemon keeps its free worker when there are fewer slots than daemons;
  - the project cap.
- `test/capacity/pool.test.ts` (7 tests, simulated daemons in one process with a temporary directory):
  - a lone daemon takes `hostSlots`;
  - a small tier takes few permits;
  - fair share: the newcomer waits one tier on its free worker, then both run their share;
  - unused slots go to the others;
  - waiter order, run both ways round, so the younger waiter reaching its boundary first still leaves the permits to the older;
  - a second lane waits for a permit;
  - the project cap.
- `test/capacity/crash.test.ts`: a child Node process takes the whole pool (`hostSlots` 4) and is SIGKILLed.
  - Before the kill, the survivor gets 1, its free worker.
  - Right after it, the survivor gets 2: the permits are back, and the dead mark still counts.
  - 30 s later it gets 4.
- `test/scheduler/capacity-pool.test.ts`: a real scheduler with a Vitest lane and a node:test lane, and a pool of 2 whose permit and another free worker are held by a simulated daemon.
  - The baseline's tiers carry `workers` between 1 and 2.
  - A Vitest backlog tier held on the free worker carries `workers: 1`.
  - An edit to the node:test project runs and is stored beside it, with no `workers`.
  - **Discrimination check**: with `selectTier` changed to ask the pool for every tier, this test fails (`expected 'pass' to be 'fail'`: the edit waits behind the held backlog tier). The change was reverted.

## For the next workers and integration

- **001-377** (user config loader): pass its numbers as `DaemonOptions.capacity`, `{ hostSlots, project: { id: <repository root>, slots } }`. `startDaemon` is called from `src/cli` (`squeal daemon`). Absent keys keep the defaults.
- **001-378** (Vitest sized from the grant): read `RunOptions.workers` in each adapter.
  - Undefined means an edit's tier or no pool: keep today's width.
  - The floor of 2 unless the project set 1, and the project's own `maxWorkers` ceiling, are that row's.
  - This row left `maxWorkers` and the environment hash alone.
- **001-379** (PSI shrink): the natural seam is `fairShares`'s `hostSlots` argument, or `TierCapacity.take`, at each backlog boundary. Edit tiers never reach it.
- **Bundles**: `plugins/claude-code/dist`, and the Pi and OpenCode bundles, drift from this source until the coordinator rebuilds (the four bundle tests in `test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts` and `opencode/package.test.ts` fail). That drift is expected.
- **Key format**: the change touches guarded sources, so `test/keys/key-format.test.ts` asks for the `KEY_FORMAT_VERSION` 10 pin (unreleased) to be redone. That is three tests: "is bumped whenever the guarded sources change" and the two "an adapter-only bump" tests. No key's meaning changes: the pool adds no key input, and `RunOptions.workers` is not read yet. The re-pin belongs to the coordinator's build commit, after 001-377 and 001-378 also land. 001-378 bumps the format anyway when `maxWorkers` leaves the hash.
- **Probe P3** (row 001-380) is not run here; it needs a calm host.
