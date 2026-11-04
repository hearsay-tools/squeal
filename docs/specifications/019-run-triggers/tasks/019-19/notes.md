# 019-19 notes: a closed Vitest instance keeps no Squeal object

Worker 933b4fd1, 2026-11-04. Brief: `tasks/wave-6.md` 019-19 (the human, 2026-11-04: option A, "report upstream + cut our refs"). Follows `tasks/019-12/notes.md`, "Heap across 20 instance cycles". The upstream half is in `upstream-issue.md`: the leak is already reported and fixed in Rolldown 1.2.16, so no new issue (the coordinator, 2026-11-04).

## What changed

- **`src/runners/vitest/adapter.ts`.** The `current` function the reporter calls is made by a static method, `#runOf(new WeakRef(this), generation)`. It answers as before: the collector of the run in progress while its instance is the current one, else `null`. It reaches the adapter only through the `WeakRef`, so a closed instance's config, which keeps the reporter, no longer keeps the `SizedVitestAdapter` and what it holds (its observer, widths, source stamps, config stamps, touches and gate).
- **`src/runners/vitest/reporter.ts`.** `onInit` registers `instance.onClose`, which sets the reporter's `vitest` to `null`. After the close, the reporter holds no instance.
- **`pnpm-lock.yaml`** (the coordinator, 2026-11-04, its own commit `cad693ea3`). `pnpm update rolldown`: Rolldown 1.2.12 → 1.2.16, inside Vite 8.3.2's `~1.2.11`. It moved rolldown, its 15 `@rolldown/binding-*` packages, and `@oxc-project/types` 0.152.0 → 0.156.0, which only rolldown depends on (1.2.16 pins it). `package.json` is unchanged; `pnpm install --frozen-lockfile` passes. **The install re-keys every result in this repository once:** at the next revision Squeal queued all 1,446 test files. `pnpm why rolldown`, before and after:

  ```text
  rolldown@1.2.12                              rolldown@1.2.16
  └─┬ vite@8.3.2                               └─┬ vite@8.3.2
    ├─┬ @vitest/mocker@5.0.3                     ├─┬ @vitest/mocker@5.0.3
    │ └─┬ vitest@5.0.3                           │ └─┬ vitest@5.0.3
    │   └── squeal@0.1.400 (devDependencies)     │   └── squeal@0.1.400 (devDependencies)
    └── vitest@5.0.3 [deduped]                   └── vitest@5.0.3 [deduped]
  Found 1 version of rolldown                  Found 1 version of rolldown
  ```

- **`test/runners/vitest/closed-unreachable.test.ts`**, two tests. (1) A real adapter on a copy of the `basic` fixture runs one file and closes; the fixture's config has a plugin that keeps each resolved config on `globalThis`, as Rolldown's native handles do, so the test does not depend on the upstream leak. After three forced GCs (`exposeGc`), a `WeakRef` to the adapter is cleared and the kept config is still there. (2) The reporter is given a stand-in instance, which then closes; a `WeakRef` to the stand-in clears. Each test failed before its change and passes after it (checked by reverting the change in place).
- **No change in `src/core/daemon/slow-instance.ts`.** `LaneInstance.drop` already lets go of its adapter and its pending paths. After 20 lane cycles, every daemon snapshot below holds 2 `LaneInstance` objects (the slow lane's map entry and the beside lane's) and, with the cut, 1 `SizedVitestAdapter`, the fast instance's.

## Why a weak reference, not a release at each close

Vitest calls `onInit` only from `start()`, `standalone()` and `mergeReports()`. A start that fails before `standalone()` never registers a close hook. A hung run's instance is abandoned (`abandon` in `run.ts`), and its close may never end. A weak reference covers every path, the instance's close or not, with no call to remember at each place that closes an instance (`#recreate`, `close`, a failed `#start`, and the broken, rejected and crashed paths). The closure comes from a static method because V8 gives all closures one function makes the same context: an arrow function in `#start` that used `this` would make every closure of `#start` hold `this`.

The reporter's `vitest` is cut at the close instead. Today that frees nothing more, because the instance is inside the same kept graph. It keeps the reporter from holding a whole instance if a later upstream change leaves only the config reachable.

## What a closed instance keeps (heap snapshots)

**In one process** (`adapter-probe.mjs`: 4 cycles of `createVitestAdapter`, one run, `close`, on the `basic` fixture; then three GCs, a snapshot, and `counts.mjs`, which counts objects reachable from the GC roots by constructor name):

| Code, Rolldown | `SizedVitestAdapter` | Squeal's others (`SourceStamps`, `VitestObserver`, `VitestWidths`, `Widths`, `ConfigStamps`, `Touches`, `Gate`) | `Vitest`, `ModuleGraph`, `PluginContainer`, `Logger`, `WorkerOutputCache` |
|---|---|---|---|
| Before the cut, 1.2.12 | 4 of 4 | 4 each | 4 each |
| After the cut, 1.2.12 | 0 | 0 | 4 each |
| After the cut, 1.2.16 | 0 | 0 | 0 |

The retainer path of each kept adapter before the cut (`tasks/019-12/retainers.mjs`):

```text
(GC roots) → (Global handles) → resolveSubpathImports (or onWarn) → its context → partialEnv (PartialEnvironment)
  → _topLevelConfig → test → reporters → [0] (Squeal's reporter) → onInit → its context → current
  → its context → this (SizedVitestAdapter)
```

**In a live daemon after 20 lane cycles** (the snapshots of the measurement below; 21 instances were made, 20 of them closed):

| Arm | Code | Rolldown | `SizedVitestAdapter` | `SourceStamps`, `VitestObserver`, `Gate` … | `Vitest`, `ModuleGraph`, `PluginContainer` | `PartialEnvironment` | `EvaluatedModules` |
|---|---|---|---|---|---|---|---|
| A2 | before the cut | 1.2.12 | 21 | 21 each | 21 each | 106 | 22 |
| B2 | after the cut | 1.2.12 | 1 | 1 each | 21 each | 106 | 22 |
| D | before the cut | 1.2.16 | 1 | 1 each | 1 each | 6 | 22 |
| C | after the cut | 1.2.16 | 1 | 1 each | 1 each | 6 | 23 |

The cut frees Squeal's objects whatever Rolldown does. Rolldown 1.2.16 frees everything else, and Squeal's objects with it. `TestProject` also falls from 21 to 1 with the cut alone: Squeal's adapter state was what held it.

## The daemon measurement: 20 lane cycles

**Method.** 019-12's probe (`daemon-probe.mjs` here: `heap-probe.mjs` with an optional heap snapshot after the last cycle), its slow arm: a real daemon in a fixture repository under the task's scratch directory, with its own `HOME`, `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR`; 120 chained modules, 10 slow test files, one fast one, a logged `globalSetup`; `slow.trigger: "continuous"`. Each cycle edits the module every test file imports, waits for the verdict, waits 5 s more, then reads the heap after two forced GCs and the private memory (`RssAnon`). Every arm logged one `globalSetup` and one teardown per cycle (21 or 22 setups, one fewer teardowns), so each cycle made and closed one slow-lane instance. The two builds are `tsrs -p tsconfig.build.json` of `57301764f` (before the cut) and `77ab6c267` (after it), in scratch copies of each commit. Rolldown 1.2.12 for arms A and B is this worktree's install before the lockfile change; for A2 and B2, an npm install of Vitest 5.0.3, Vite 8.3.2 and Rolldown 1.2.12. Rolldown 1.2.16 is this worktree's install after `cad693ea3`.

Host: Linux 6.8.0-147, 24 CPUs, Node v24.22.1. A and B ran together from 08:34:47Z, one-minute load 36.9 to 40.1; A2, B2, C and D ran together from 08:39:12Z, load 39.5 to 59.5. The load came from other sessions; the probes added four small daemons. Heap does not depend on load. The rates leave out cycles 1 and 2: in the second set, cycle 1 was read while a run was in flight (A2 logged a child process), and its heap was 3 MB above the line.

| Arm | Code | Rolldown | Heap, cycle 3 → 20 (MB) | Heap a cycle, 3–20 / 10–20 | Private memory, cycle 3 → 20 (MB) | Private a cycle, 3–20 / 10–20 |
|---|---|---|---|---|---|---|
| A | before the cut | 1.2.12 | 39.7 → 44.9 | 0.31 / 0.24 | 168.5 → 193.9 | 1.49 / 1.12 |
| A2 | before the cut | 1.2.12 | 39.2 → 44.5 | 0.31 / 0.24 | 134.2 → 160.3 | 1.54 / 1.37 |
| B | after the cut | 1.2.12 | 39.7 → 45.2 | 0.32 / 0.25 | 160.1 → 184.6 | 1.44 / 1.27 |
| B2 | after the cut | 1.2.12 | 39.2 → 44.5 | 0.31 / 0.21 | 128.8 → 162.9 | 2.01 / 1.58 |
| D | before the cut | 1.2.16 | 38.5 → 40.7 | 0.13 / 0.06 | 126.9 → 145.4 | 1.09 / 1.01 |
| C | after the cut | 1.2.16 | 39.1 → 41.6 | 0.15 / 0.08 | 118.8 → 133.8 | 0.88 / 0.57 |

Per-cycle heap (MB), start and cycles 1 to 20: A 38.6 38.6 39.2 39.7 40.5 40.7 41.5 41.6 41.9 42.6 42.5 43.0 43.0 43.3 43.5 43.8 44.0 44.2 44.8 45.0 44.9; B 38.6 38.6 39.5 39.7 40.1 40.7 41.3 41.8 42.1 42.5 42.7 42.9 42.9 43.5 43.8 44.1 44.0 44.2 44.7 45.0 45.2; C 38.2 41.8 38.4 39.1 39.3 39.7 40.1 40.6 40.6 41.0 40.8 41.1 40.9 41.2 41.3 41.3 41.2 41.2 41.5 41.6 41.6.

**What the numbers say.**

- **The cut alone changes no total on this fixture.** With Rolldown 1.2.12, heap grows 0.31 to 0.32 MB a cycle before and after it, and private memory 1.4 to 2.0 MB. Squeal's per-cycle objects are a small part of what a closed instance keeps; the rest is Vite's and Vitest's graph, which Rolldown keeps. Two runs of one arm (A and A2, B and B2) differ by up to 0.6 MB a cycle in private memory, so a smaller difference is not a result.
- **Rolldown 1.2.16 is what frees the memory.** Heap growth falls to 0.13 to 0.15 MB a cycle over cycles 3 to 20, and 0.06 to 0.08 over cycles 10 to 20: less than half of 1.2.12's 0.31 to 0.32, and 0.21 to 0.25. Private memory growth falls to 0.9 to 1.1 MB a cycle, and 0.6 to 1.0 over cycles 10 to 20.
- **Private memory is still not flat.** With 1.2.16 it grows 0.6 to 1.0 MB a cycle. 019-12's control arm, which made no new instance (one kept open), grew 0.7 MB a cycle on 2026-11-03, at another commit and load. So the remainder is probably the daemon's own growth, not a closed instance. A same-day control was not run: at 126 s a cycle, 20 cycles take 42 minutes. The board row's done-when, "A daemon's memory stays flat across 20 lane cycles", holds for heap with Rolldown 1.2.16, and not yet for private memory.

## A second, small retention (not reported upstream)

Every daemon arm keeps one `EvaluatedModules` per instance made (22 or 23), Rolldown 1.2.16 included. Vite's module runner (`interceptStackTrace` in `vite/dist/node/module-runner.js`) adds each runner's `EvaluatedModules` to a module-level `Set`, which `Error.prepareStackTrace` reaches; only that runner's own close removes it. Some runner of each instance is not closed; which one was not determined. The Squeal-free reproduction keeps 5 after 5 closes with Vitest 5.1.0, Vite 8.3.5 and Rolldown 1.2.16, with or without a `globalSetup`. Each kept one is empty: the 20-cycle daemon snapshot (arm C) holds 2 evaluated module nodes in all, the live instance's. That is a few hundred bytes an instance, so it is noted here and not drafted as an issue.

## Decisions the spec did not settle

1. **A weak reference from the reporter to the adapter**, not a release call at each close (above).
2. **No new upstream issue**, and a comment on rolldown/rolldown#10887 only as a draft (the coordinator, 2026-11-04).
3. **The lockfile update moves `@oxc-project/types` with rolldown** (the coordinator accepted it, 2026-11-04: rolldown 1.2.16 pins it).
4. **No change in `slow-instance.ts`**: it already drops each lane's adapter at the close.

## For the next worker

- A Squeal user gets the upstream fix when their own lockfile takes Rolldown 1.2.16 or later; Squeal does not pin it for them. Whether Squeal should note an older Rolldown in status is a product decision; this row does not make it.
- With Rolldown 1.2.16, 019-12's option (c), keeping a lane's instance open between passes, is no longer needed for memory by these numbers. It would still save one instance start and one `globalSetup` per pass.
- The bundles (`plugins/*/dist`, `cli/squeal.mjs`) are not rebuilt: the brief says no build. The three bundle tests fail until the coordinator builds them.
- A `WeakRef`'s `deref` keeps its target alive until the current job ends. A probe must take its heap snapshot before it counts with `deref`, or every target shows as kept (`adapter-probe.mjs` does this).
- Probe files beside these notes: `adapter-probe.mjs` (one process), `daemon-probe.mjs` (a live daemon), `counts.mjs` (reachable objects by constructor), `repro/` (Squeal-free, `upstream-issue.md`). The builds, fixtures, logs and snapshots were in the task's scratch directory and were deleted after the measurement.
