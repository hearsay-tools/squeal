# 019-12 notes: a runner instance and a priority per lane

Worker d599257b, 2026-11-03. Survey L3 (`research/lanes-survey.md` 1, 3, 5). Spec 019 D3; open question 7; survey open question 5.

## What changed

- `withSlowInstance` (`src/core/daemon/slow-instance.ts`) keeps one `LaneInstance` per lane string. A run whose lane is not the fast instance's own lane (`fast.name`, or `fast.lane(file)`) and not a beside lane goes to the instance of that lane: `slow:vitest` today, `group:<name>:vitest` once 019-10 routes groups. The instance is made on the lane's first run and closed by `releaseLane` of that lane alone. `SlowRelease` is already per lane, so its 60 s bound closes each lane's instance as it closes the slow one's. A map entry stays after its close, so the lane's next run waits for the close (and its `globalSetup` teardown) before it makes a new instance. The map is bounded by the number of group lanes.
- The daemon (`daemon.ts`) makes each lane's instance with `laneInstanceWorkers(vitestLaneGroup(policy, lane))`: the group's `maxWorkers`, or its `maxParallel` when more. For the default `slow` group that is `max(slow.maxWorkers, slow.maxParallel)`, as before. A group with neither key gets `undefined`, the configs' own width, as the fast instance does. A failure note of a group's instance reads `group <name>: <message>`; the slow one's keeps `the slow tier's <message>`.
- `RunOptions.priority` (`src/core/types/runner.ts`, additive, `CheckPriority`). `lowerWhile` takes the priority and gives idle I/O to a `"low"` run's processes, in any lane. `afterEachRun` (`escaped.ts`, one line) passes `runPriority(options.priority, lane)`: the priority the run names, else `"low"` in a `slow:` lane and `"normal"` in any other. That keeps today's behaviour until the scheduler sets the field.
- node:test (`adapter-project.ts`) and pytest (`adapter-run.ts`) start every file of a run in any group lane, as they did in a slow lane: the lane is not the adapter's own lane (`node-test`, `pytest`) and not a beside lane.

## Integration points with 019-10

019-10 defines `GROUP_LANE_PREFIX`, `groupLane` and `isGroupLane` in `src/core/types/scheduler.ts`. This row defines none of them (the coordinator, 2026-11-03). These places use a generic test instead. Each is marked `019-10 integration` in a comment:

1. `ownInstance` in `slow-instance.ts`: a lane other than the fast instance's own and a beside lane. Becomes `isGroupLane(at)`.
2. `vitestLaneGroup` in `slow-instance.ts`: writes `group:<name>:vitest` itself. Becomes `groupLane(group.name, "vitest")`.
3. `groupRun` in `src/runners/node-test/adapter-project.ts` and in `src/runners/pytest/adapter-run.ts`. Becomes `isGroupLane(lane)`.

019-10 must set `RunOptions.priority` on each tier's run from its group's `limits.priority` (`runTier` in `tiers.ts`). Without it, a configured group runs as `"normal"` whatever its `limits.priority` says (no idle I/O), and the default `slow` group stays `"low"` only through the fallback.

## Decisions the spec did not settle

1. **Releasing one lane closes only that lane's instance.** Before, `releaseLane("slow:node-test")` also closed the Vitest slow instance, because the check was the `slow:` prefix. Now a release reaches only the instance of the lane it names. The scheduler releases each lane by its own name (`#slowEnded`, `SlowRelease.idle`), so the Vitest slow instance still closes when its own pass drains, on a hold, or 60 s after its last run. Effect: in a project with slow Vitest and slow node:test files, the Vitest slow instance no longer closes and reopens (with its `globalSetup`) between two slow Vitest tiers when a slow node:test tier ran between them. No text, lane, activity row or tier order changes.
2. **The width of a group's instance** follows the slow rule (`maxWorkers`, raised to `maxParallel`). A group with no limits takes the configs' own width, not `runner.tierSize`.
3. **Kept the name `withSlowInstance`** and the file name. Eight test files import it, one of them 019-10's `test/scheduler/helpers.ts`. A rename is a later quality row.

## Heap across 20 instance cycles in a live daemon

Spec open question 7, survey open question 5. Measured 2026-11-03 on this host (24 CPUs, one-minute load 15 to 54 from other sessions; the probe added one small fixture's runs). Heap does not depend on load; the cycle times do.

**Method** (`heap-probe.mjs`, beside these notes). A real daemon, built from this branch (`dist/cli/index.js` at 01e62f35c), started by `squeal start` in a fixture repository under the task's scratch directory, with `HOME`, `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR` of its own (its own socket, pool and slot; nothing of the user's). Fixture: 120 chained TypeScript modules, 10 test files under `test/slow/` (5 tests each, each file importing 110 to 120 of the modules), 1 file under `test/fast/`, and a Vitest `globalSetup` that logs each instance's setup and teardown. After `squeal run --all --wait`, each cycle edits `src/m0.ts`, which every test file imports, waits with `squeal status --wait`, waits 5 s more, then reads the daemon's main-thread heap through its inspector (opened by `SIGUSR1`) after two forced GCs, and its private memory (`RssAnon`).

- **Slow arm:** `slow.include: ["test/slow/**"]`, `trigger: "continuous"`, `quietMs: 0`, `maxLoadPerCpu: 1000`. Each cycle is one slow pass: a new slow-lane instance, its run, its close when the pass drains. The `globalSetup` log shows one setup and one teardown per cycle (21 setups and 20 teardowns after 20 cycles: the fast instance's setup plus 20 slow instances made and closed). No test process was left after any cycle.
- **Control arm:** no `slow` key. The same edits; every file runs in the fast instance, which stays open (1 setup, 0 teardowns). Each cycle took 126 s (an edit's tier, then the 120 s catch-up for the rest). It stopped at cycle 7 when the session ended; 7 cycles give its rate.

| Arm | Cycles | Heap, start → end (MB) | Heap per cycle | Private memory, cycle 1 → end (MB) | Private memory per cycle |
|---|---|---|---|---|---|
| Slow: an instance made and closed per cycle | 20 | 38.4 → 46.1 | 0.39 MB | 136.7 → 178.2 | 2.2 MB |
| Control: one instance kept open | 7 | 39.0 → 40.6 | 0.23 MB | 120.9 → 125.1 | 0.7 MB |

The slow arm's cycle 16 was read while a run was in flight (one child, one teardown short) and is left out of the rates; cycle 17 is back on the line. Per-cycle heap readings: 38.6, 39.5, 40.2, 40.7, 41.4, 41.9, 42.8, 43.2, 43.6, 43.9, 44.2, 44.4, 44.7, 44.9, 45.2, (49.2), 45.4, 45.7, 45.9, 46.1. The growth does not level off within 20 cycles.

**What a cycle keeps.** A third run (13 slow cycles) took heap snapshots after cycles 3 and 13. Between them the heap's self size grew 4.0 MB (0.4 MB a cycle, as in the slow arm): 2.1 MB compiled code, 0.7 MB arrays, the rest objects, strings and closures. **No closed instance is ever freed.** Each cycle adds exactly one each of `Vitest`, `TestProject`, `ModuleGraph`, `PluginContainer`, `Logger`, `EvaluatedModules`, and of Squeal's `SizedVitestAdapter`, `VitestObserver`, `VitestWidths` and `WorkerOutputCache`; and 5 `BuiltinPlugin` (Rolldown's), 2 `RunnableDevEnvironment`, about 42 `handler` closures. At cycle 13 all 15 instances made so far were reachable.

**Why** (survey open question 5, now determined). Retainer paths in a snapshot after 4 cycles: each closed instance is held from V8's global handles by callbacks a Vite environment gave Rolldown's native bindings (`onWarn`, `resolveSubpathImports`). Their closures hold the `PartialEnvironment`, its resolved config, and through it two things:

1. the config's `plugins`, whose `PluginHarness` holds the `Vitest` instance (Vite and Vitest code);
2. the config's `test.reporters`, which holds Squeal's reporter (`createSquealReporter`, `src/runners/vitest/reporter.ts`), whose `onInit` closure keeps `current` (a closure over its `SizedVitestAdapter`) and `vitest`.

Cutting Squeal's reporter references in the snapshot (treating those edges as gone) leaves 1 of 6 `SizedVitestAdapter` reachable, the live one, but still 6 of 6 `Vitest`, through path 1. So a Squeal-side fix (the reporter drops `current` and `vitest` when its instance closes) frees Squeal's own adapter state per cycle but not Vitest's instance graph, which only the upstream native handles release. The private memory per cycle (about 1.5 MB more than the control) is probably Rolldown's native allocations held by the same handles; not determined.

**For open question 7.** One instance per Vitest group lane, made per pass and closed after 60 s, costs on this fixture about 0.16 MB of heap and 1.5 MB of private memory per make-and-close cycle beyond the daemon's own growth, never returned while the daemon lives. The survey's standalone probe found about 4 MB of heap per cycle on a larger fixture, so the cost grows with the modules a group imports. At one slow pass a minute that is roughly 90 MB of private memory an hour on this fixture, until the daemon exits (`daemon.idleExitMinutes`, 60 by default). The slow lane pays it today; each more Vitest group lane with its own passes adds its own cycles. Options, for the coordinator: (a) ship as is and file the leak upstream with the retainer path above; (b) a fix row in `src/runners/vitest/` to cut the reporter's references at close (frees the adapter, not Vitest); (c) keep a group lane's instance open between passes when the group has no `globalSetup` to tear down, so it pays one instance, not one per pass. This row changes none of these; it keeps the 60 s close the brief asks for.

Probe files: `heap-probe.mjs` (the two arms) and `retainers.mjs` (a shortest retainer path per object of one constructor in a `.heapsnapshot`, with edges by name treated as cut). The fixtures, logs and snapshots were in the task's scratch directory and were deleted after the measurement.
