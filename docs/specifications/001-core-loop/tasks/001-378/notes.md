# 001-378: Vitest sized from the grant; maxWorkers out of the key; nice for every runner

Worker notes, 2026-10-15. Spec 001 D11 Capacity (Runner ceiling, Priority); `research/host-capacity.md` probe P1.

## P1: a warm instance resizes between runs

*Verified by experiment*, Vitest 5.0.3, Node 24.21.0, host load 25 to 69 (24 CPUs). Script: `p1/probe.mjs`, run from a scratch directory whose `node_modules` links to this worktree's.

- **Method.** A 40-file fixture; each file's one test sleeps 250 ms and appends its pid, `VITEST_POOL_ID`, start and end to a log. One instance (`createVitest('test', { watch: false })`, `standalone()`), then all 40 files run three times with `maxWorkers` 8, 2 and 8, set between the runs on `vitest.config` and every `project.config`. The peak is the most files whose intervals overlap.
- **Result.** Every run honoured the width it was given:

  | pool | isolate | maxWorkers | peak overlap | pool ids | pids | wall |
  |---|---|---|---|---|---|---|
  | forks | true | 8 / 2 / 8 | 8 / 2 / 7 | 8 / 2 / 8 | 40 / 40 / 40 | 4.2 / 15.1 / 4.3 s |
  | threads | true | 8 / 2 / 8 | 8 / 2 / 8 | 8 / 2 / 8 | 1 / 1 / 1 | 6.3 / 15.1 / 4.8 s |
  | forks | false | 8 / 2 / 8 | 8 / 2 / 8 | 8 / 2 / 8 | 8 / 2 / 8 | 1.9 / 5.7 / 1.5 s |

  The 7 of the third forks run is the load (a fork that started late), not a cap: its pool ids reached 8.
- **Why** (*read in source code*, `dist/chunks/index.DpLw24bj.js`). `createTaskGroups` calls `resolveMaxWorkers(project)` for every run, and the pool calls `setMaxWorkers` per task group. `resolveMaxWorkers` reads `project.config.maxWorkers`, then `project.vitest.config.maxWorkers`, then the CPU default. `serializedConfig` is recomputed on each read, so tests see the width too (`serialized` in the probe's output).
- **Decision.** No recreate. The adapter writes the width into the resolved configs before each run and restores the project's own values when a run has no grant.

### A finding on the way: the CLI option overrides a project's own maxWorkers

A second probe printed each project's resolved `maxWorkers` for a root config `{ maxWorkers: 3, projects: [a (extends), b (extends, maxWorkers 2), c] }`:

- Without options: root 3, `a` 3, `b` 2, `c` 3.
- With `createVitest(..., { maxWorkers: 5 })`: root 5 and every project 5, `b` included.

So today's slow instance, created with `maxWorkers: max(slow.maxWorkers, slow.maxParallel)`, runs a project that set 2 at 4. D11's ceiling forbids that. The slow instance now gets its width per run, as the main one does, and the creation option is gone.

## What changed

- **Width per run** (`src/runners/vitest/width.ts`, `adapter.ts`). `Widths` records, at each instance start, the root's and each project's resolved `maxWorkers`: the project's own ceiling. Before each run, `apply` writes `tierWidth(want, ceiling)` into `vitest.config` and into every project config that has a value of its own. A project without one reads the root's, as `resolveMaxWorkers` does.
  - `want` is `RunOptions.workers`, else the instance's constructor `maxWorkers` (the slow instance's `max(slow.maxWorkers, slow.maxParallel)`), else nothing.
  - `tierWidth`: no `want` gives the ceiling back (`undefined` means Vitest's default); a ceiling of 1 stays 1; otherwise `max(2, want)`, capped by the ceiling.
  - An edit's tier carries no grant, so it runs as the project's config says, with at most `runner.tierSize` files. That is the width it had before.
  - `createVitest` no longer gets `maxWorkers` (the finding above).
- **Key** (`environment.ts`). `canonicalConfig` drops `maxWorkers`. Key format 10 re-pinned in place (`b82febb0…`); no `squeal--v*` tag carries 10 (the latest, 0.1.168, carries 9).
- **Priority** (`src/core/daemon/low-priority.ts`, `escaped.ts`, `src/runners/node-test/run/process.ts`).
  - `afterEachRun` runs `lowerWhile` for every lane, not only slow ones. `ionice -c 3` stays with slow lanes (004 D2). D11 asks for `nice` only, and idle I/O would slow an edit's tier behind any disk load.
  - `startGroup` (node:test and pytest) lowers its process right after the spawn. The process and what it spawns run at `nice` 10 from the start, with no polling window.
  - `SLOW_NICE` is now `TEST_NICE`, and `lowerProcess` is exported.

## Tests

- `test/runners/vitest/width.test.ts`. Each fixture file records its `VITEST_POOL_ID`, which runs from 1 to the run's `maxWorkers`.
  - The grant sizes one warm instance: 3, 5, 2, then 6 (the project's own) for a run without a grant.
  - The project's ceiling holds: 2 under a grant of 7. A project that set 1 runs at 1 under a grant of 4, and an unset project runs at 2 under a grant of 1.
  - Per-project ceilings, root 3 and project `b` 2 (its own `groupOrder`): 3 and 2 at grant 6, then 2 and 2 at grant 2.
  - The slow instance (`maxWorkers: 4` at creation) is held to a project's 2. Under a project's 6 it runs at 4, and at 5 when granted 5.
  - `resolvedConfig` has no `maxWorkers`, and it is the same before and after a run granted 3.
  - Red before the change: 4 of the 5 first tests failed (the instance ran at its own 6, or at the creation width 4).
- `test/runners/node-test/process-priority.test.ts`: a `startGroup` process and its child report `nice` 10. Red before: both were 0.
- `test/daemon/escaped-overlap.test.ts`: the fast lane's carrier is now polled to 10. It used to be asserted unlowered. Red before (0 after 10 s).
- Both priority tests compare against an absolute 10. Run under a process that is already at `nice` 10 (a daemon of this release), they hold trivially. Run from a shell at 0, they discriminate, and that is how they were seen red.

## Decisions the spec did not settle

1. **The slow instance is held to the project's ceiling too.** Before this change its creation option overrode a project's own `maxWorkers`.
2. **The floor applies to the slow instance's own width** as to a grant. With `slow.maxWorkers` 1 and `slow.maxParallel` 1, it runs at 2 unless the project set 1. D11 states the floor for Vitest without exception.
3. **`ionice -c 3` stays with slow lanes.** It is not part of D11's Priority.
4. **The ceiling is what the configs resolved to.** That includes `fileParallelism: false` and `VITEST_MAX_WORKERS` in the daemon's env, both of which resolve to a value Vitest itself would honour.

## Known gap: short Vitest forks run unlowered for up to a second

A Vitest fork pool with `isolate: true` starts one process per file (P1: 40 pids for 40 files). `lowerWhile` takes its first look 250 ms after the run starts and then one every second. A fork that lives less than that may never be lowered, and one that lives longer runs its first part at the daemon's priority.

- The slow lane never minded, because its files are long. A backlog tier's short files mostly escape.
- A shorter poll costs a full `/proc` scan each time: about 29 ms at 660 processes on this host under load 25 to 69.
- Thread-pool workers are threads of the daemon, as before, and keep its priority.

Two ways to close the gap, for a later row:

- **(a)** Walk only the daemon's subtree (`/proc/<pid>/task/*/children`) every 100 ms. That is cheap, and orphans don't matter, since what a lowered process starts inherits its priority.
- **(b)** Have the worker lower itself at start, in the recorder preload: `os.setPriority` on each of `/proc/self/task`. That covers thread workers too, but only while observing, and the Fidelity section weighs every addition a test could see.

## Proposed D11 wording

Runner ceiling, replacing its last two sentences:

> Vitest runs each backlog or checkpoint tier at its grant, at least 2 (with `isolate: false` one worker takes every file of a project) unless the project set 1, and never above the `maxWorkers` the project's config resolves to, per project (the root's for a project without its own). The warm instance is resized before each run, not recreated (probe P1, task 001-378): Vitest reads `maxWorkers` from the resolved configs at every run. An edit's tier, which carries no grant, runs at the project's own width, and the slow tier's instance at `max(slow.maxWorkers, slow.maxParallel)` when it has no grant, under the same ceiling and floor. `maxWorkers` leaves the environment hash (D3; key format 10, task 001-378).

Priority, replacing it:

> Every test process Squeal starts runs at `nice` 10, and what it spawns inherits it. A node:test or pytest process is lowered as it is spawned. A Vitest fork worker is found by its lane's mark and lowered within a second of its start, so a fork shorter than that may finish at the daemon's priority. A thread-pool worker is a thread of the daemon and keeps its priority. A slow lane's processes also run at `ionice -c 3` where permitted (004 D2).

## Review 001-394 B2

Worker notes, 2026-10-15. Spec 004 D2 (a slow tier of several files starts them all at once, so none starts after an edit or a close) against 001 D11 Runner ceiling.

### The defect

`SlowTier.#select` picked up to `slot.permits` files and the pool grant. Since this row, the Vitest adapter runs each tier under the project's own `maxWorkers`. With `slow.maxParallel` 4 and a project at 2, a tier of 4 started 2 files, and Vitest's pool started the other 2 only as those ended: after an edit, or after the scheduler closed. Seen red: the new scheduler test's first slow run held 4 files, and on close 4 files had started, not 2.

### What changed

- **`RunnerAdapter.slowWidth?(testFiles)`** (`src/core/types/runner.ts`, additive and optional). It returns how many of `testFiles`, in order, one slow run starts at once, at least 1. It is synchronous, since `#select` runs under the scheduler's lock. Absent means all of them.
- **Vitest** (`width.ts`, `Widths.atOnce`; `adapter.ts`, `slowWidth`).
  - The width is the first file's project's ceiling (its own `maxWorkers`, else the root's): `tierWidth(files, ceiling)`. A slow run's width is at least one worker per file, either the slow instance's `max(slow.maxWorkers, slow.maxParallel)` or a grant of `slow.maxWorkers` per file. So only the ceiling binds. A project that set 1 gives 1, and a project with no value gives every file.
  - The count also stops at the first file of another task group. Vitest's `groupSpecs` runs a run's groups one after another: by `sequence.groupOrder`, plus a last group for an isolated project of order 0 that set 1. A tier that spans two groups would start the second group's files late too.
  - Within a group Vitest requires one `maxWorkers`, so the first file's width holds for the group.
  - The fast instance answers. The slow instance has the same configs, and it exists only once a slow run asked for it.
- **Wrappers.** `withSlowInstance` forwards to the fast adapter, and the recovering runner and `afterEachRun` forward to their inner runner. The composite asks only the first file's adapter, about the prefix of the files it owns, because its parts run one after another.
- **`#select`** truncates `picked` to the reported width right after the pick loop. That comes before the pool take, so the lease is `files × slow.maxWorkers` of what runs. It also comes before `startTier`, the claims and the activity. `#pick` has no side effect on a file it returns, so the deferred files stay queued. The slot shrinks to the files that started, as before.

### Tests

- `test/scheduler/slow-width.test.ts` uses the real scheduler over the real Vitest adapter. The `basic` fixture's config is set to `maxWorkers: 2`, with `slow.maxParallel` 4, four slow files and a pool of 8. A run wrapper dispatches each slow run as Vitest's pool does: its first 2 files start, and the rest start only once the first run is released.
  - Edit. With the first 2 files held, the tier holds 2 files, 2 permits (another owner takes the other 2) and a grant of 4. An edit to `src/math.ts` is batched, and then the run is released. The other 2 files start only in a second slow run, after the edit's fast tier.
  - Close. With the first 2 files held, `close()` is called and then the run is released. Only 2 files ever start, in one slow run.
  - Both were red before the fix. The edit test failed on the first run's 4 files, and the close test saw 4 starts.
- `test/runners/vitest/width.test.ts` checks the width the real adapter reports.
  - The width is 2 for a project at 2 and 1 for a project at 1. A project without `maxWorkers`, or one at 6, gives all 4 files.
  - On the slow tier's instance (`maxWorkers: 4`), a run of exactly the reported files takes one worker per file.
  - With root 3 and project `b` at 2 in `groupOrder` 1, `a`'s files give 3 and `b`'s give 2. A run that mixes `a` and `b` stops at the group boundary, giving 1.
- `test/daemon/slow-width.test.ts` checks the forwarding.
  - The slow-instance wrapper answers from the fast adapter without creating a slow instance, and `afterEachRun` passes the answer on.
  - The composite stops at another adapter's file. An adapter with no `slowWidth` starts all of its own files.

### Decisions the review did not settle

1. **Group boundaries count, not only the per-project width.** A tier of projects in different `groupOrder`s would otherwise start one group's files after the other group's ended, which is the same defect.
2. **The fast instance answers for the slow one.** Both read the same configs, and asking the slow adapter would create its instance at selection time, under the lock.
3. **`slowWidth` takes the files, not a project.** The answer depends on the order and on group membership, and only the runner knows the groups.
4. **The slow tier still yields the first file even when the width is 0 or less** (`max(1, …)`), so a misreporting runner cannot stall the slow queue.
