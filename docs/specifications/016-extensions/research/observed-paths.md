# 016-13 The observed-path survey

Researcher 33ca81bf, 2026-10-25. Brief: `tasks/wave-0.md`, section 016-13; spec D4, goals 5 and 6. Code read at `793dfc3d4` (main, 2026-10-25). Probe: `probes/observed-paths/` (Node 24.21.0, tsx from the worktree, scratch repository under `/tmp`).

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | What each runner observes, where it is kept, who reads it back | Vitest: file reads, listings and loads per test file. It is kept in `observed.<project>` and in the stored closure, and the core's keys read it. node:test and pytest: module loads per test file, plus one start-up set per project. They are kept in four runner meta keys and merged into the stored closures. Each adapter reads them back in `closure()`, `affected()` and `environment()`. pytest's `direct` marks live in memory only. | read in source code; node:test verified by experiment |
| 2 | The core's steps the injected stores lack | Twelve differences, O1 to O12 below. Three can change a verdict: O1 (git-ignored paths), O8 (the policy gate) and an older daemon on the same store during migration (O9, Q5). The others change cost or order only. | O1 verified by experiment; the rest read in source code or inferred |
| 3 | Does any node:test or pytest step drop git-ignored paths? | No. No step drops them: not the recorder, not `observedClosure`/`observeBatch`, not the tracker, not the store. The core's keys then watch these paths as extra files, so the paths key. | verified by experiment (node:test); read in source code (pytest) |
| 4 | What an adapter needs back, read-only | Little. The core can assemble all three things itself: closure paths (it already does), start-up paths into the environment files, and stored `direct` marks into `affected().direct`. The adapter then needs nothing back. The fallback interface is one read-only view with two methods. | inferred from source code |
| 5 | Migration of the meta entries | The shapes match. `nodeTest.observed.*` and `pytest.observed.*` hold the same JSON map as `observed.<project>`. A copy merges them in one transaction. An older daemon's core already reads `observed.<project>` for every runner's files. But an older daemon keeps writing the old keys. So the new daemon must keep reading those keys while older daemons can run. | verified by experiment (shape and read-back); rest read in source code |

## Findings

### Q1. The two paths today

**Vitest (the core's path).** The recorder (`src/runners/observe/recorder.cjs`, C12) records reads, stats, listings, loads and spawn arguments. `observedInputs` (`src/runners/observe/inputs.ts`) drops paths outside the worktree, under `node_modules` or `.git`, written paths and plain directories. Vitest returns the result in `RunReport.observed`. Under the scheduler lock, `observedGrowth` and `prepareObserved` (`src/core/scheduler/observed.ts`) take the paths the closure lacks. These steps then run in order: add link targets, expand recursive listings, drop git-ignored paths, merge what other worktrees observed (`keys.observedOf`), hash every file path into the stat cache (`keys.track`), and mark `firstSeen`. `storeDecision` (`store-decision.ts`) then decides: an unstable path discards the result; a `firstSeen` path stores nothing and re-runs the file; otherwise the result is stored under the grown key. `tiers.ts:741` calls `keys.addObserved`. That merges into `observed.<project>` (`ObservedSets.add`, `src/core/keys/observed.ts`) in one transaction, and `storeClosures` writes the grown closure. Read back: `setClosure` assembles the observed set into every closure while `observe.runtimeInputs` holds (`keying.ts:367`). That happens at bootstrap, after a restart, and at a worktree's first keying. `refreshObserved` runs before each tier is recorded. The edit cut reads `observedOf` (`edit-cut.ts:148`). The Vitest adapter itself never sees the set.

**node:test.** The runtime recorder (`src/runners/node-test/runtime/recorder.cjs`) logs every resolved import edge. `observedClosure` (`run/observed.ts`) keeps project files and splits them into `paths` (test file) and `preloadPaths`. `Observed.record` (`adapter-observed.ts`) takes the paths beyond the static graph and calls `graph.recordObserved`. It then writes through the injected `observedStore` (`src/core/daemon/node-test-runners.ts:30`). That store merges into `nodeTest.observed.<project>` and unions the paths into the stored closure of each test file, in one transaction. Preload paths go to `nodeTest.observedPreloads.<project>` and back to the core as `RunReport.environmentObserved`. The run's result stays under the key it ran under. Read back: the tracker reads the store when the adapter opens, which covers a restart and a new worktree. It reads it again at each `invalidate`, `affected` and `closure` (cached on the raw string). `closure()` returns static plus observed paths. `affected()` reports observed paths as `transitive`, and another worktree's growth once as `transitive` (`takeGrown`). `environment()` adds the observed preloads, and `takeRecreate` recreates the project when another worktree grew them. A lifecycle timer polls the node:test keys and queues a refinement (`lifecycle.ts:346`, task 003-26). `unresolvedPreloads` (`growth.ts`) reads the preload key so that a key which lacks a preload heals nothing.

**pytest.** `squeal_pytest.py` and `sitecustomize.py` record project-file imports: paths under `SQUEAL_PYTEST_ROOT` and outside `sys.prefix`. Since 007-55 they also record what child Python processes import (`spawned`). `observeBatch` (`run/observed.ts`) builds `paths`, `spawned` and a batch `session` set. The tracker works as node:test's does, with three changes. `outside` drops the environment directory. `recordSession` keeps start-up paths that are not in a plugin's closure and not in every listed file's closure. `recordSpawned` calls `graph.recordSpawned`, which makes `affected` put the file in `direct`, in memory only (row 007-56). The store is `pytestObservedStore` (`pytest-runners.ts:32`) with the keys `pytest.observed.*` and `pytest.observedSession.*`. Spawned paths are stored among the other observed paths, so after a restart they read as `transitive`. Focused runs record nothing (`adapter.ts`, row 011-145). The lifecycle timer does not poll the pytest keys, and `unresolvedPreloads` does not read the session key.

### Q2. Differences between the core's path and the injected stores

| Id | Step | Core | Injected (node:test, pytest) | Verdict change after D4? |
| --- | --- | --- | --- | --- |
| O1 | Git-ignored path | Dropped before `track` (`observed.ts`, `checkIgnored`) | Kept. `keys.track` makes it an extra file the watcher watches (`keying.ts:525`, `WatchSpec.extraFiles`, 004-50), so it keys | **Yes.** Probe 1: a computed `import()` of git-ignored `dist/x.mjs` enters the node:test store and `closure()`. Probe 2: `observedGrowth` drops it. After D4, an edit of `dist/x.mjs` re-keys nothing, and the stale result of 009 lessons observation 4 then reaches node:test and pytest |
| O2 | Stat-cache hashing, `firstSeen` | Every growth path is hashed at record time. A path first hashed after the run began stores nothing and re-runs, bounded by `MAX_DISCARDS` | Not hashed at record time. Hashed later by `trackUntracked` when the closure is fetched again | No. Cost: one extra run when a path appeared during the run |
| O3 | Key the result is stored under | The grown key (`store at grown`), after a stability check of the growth paths | The key it ran under. Growth reaches this worktree's key at the next closure fetch. Another worktree re-runs once ("a spare run", 003 D3) | No, inferred. Fewer spare runs. The core's stability check is the guard the injected path does not need, because its key lacks the paths |
| O4 | Link targets | `linkTargets` adds the target spelling | node:test and pytest record real paths (Node resolves module URLs; `_project_file` calls `realpath`) | No. Probe 3: a real path gains nothing; a link path gains its target. Neither runner keys a link retarget for observed-only loads, before or after |
| O5 | Listings, recursive listings | Keyed as listing paths | Not observed (imports only) | No |
| O6 | Merge and lock | `ObservedSets.add`: one transaction per test file under the scheduler lock. The stored closure is replaced by this worktree's assembled closure | One transaction per run. It unions into the meta key and into every stored closure | No. Bootstrap's `setClosure` adds the shared set back, while the policy holds |
| O7 | `.git` entry | Keyed by kind, never `firstSeen` | The node:test and pytest recorders never record `.git` | No |
| O8 | Policy `observe.runtimeInputs` (default true) | Observed paths join closures only while it holds (`keying.ts:371`) | Module loads key always, whatever the policy | **Yes, with the policy off.** A computed import's target leaves the key, so its edit re-runs nothing |
| O9 | Another worktree's growth | Read at first keying and before each tier is recorded. A current file is not re-keyed in between | Reported at the next refinement as `transitive`, so the closure is fetched again and the file re-keyed. The timer polls the node:test keys only | No in steady state, inferred: a worktree whose run read the path observed it itself. **Yes during mixed versions** (Q5) |
| O10 | Start-up paths | `environmentObserved` drives `rekeyEnvironments`, but the core keeps no project-level set | Kept by the adapter, served in `environment()`, polled for node:test only | No, provided the core keeps and serves the set. pytest's session set is missing from `unresolvedPreloads`, today and after |
| O11 | pytest `direct` marks | None | In memory only | No. Order inside the edit cut (row 007-56) |
| O12 | Key namespace | `observed.<project>`, the same for every runner | One key prefix per runner | Not determined. No cross-runner uniqueness check of project names was found in `src/core/daemon/policy.ts`. A shared name merges two maps by test path, which can only add paths (over-key) |

### Q3. Git-ignored paths in node:test and pytest

**node:test (verified by experiment).** In the scratch repository, `.gitignore` holds `dist/`, and `t.test.mjs` imports `./dist/x.mjs` and `./src/y.mjs` by computed specifiers. The real adapter wrote `{"t.test.mjs":["dist/x.mjs","src/y.mjs"]}` to the store, and `closure()` returned both paths (`probes/observed-paths/output.txt`). The recorder logs every resolved edge. `observedClosure` filters with `WorktreePaths.isProjectFile` only: outside the root or under `node_modules`.

**pytest (read in source code).** `_project_file` keeps real paths under the root and outside `sys.prefix`, `base_prefix` and `exec_prefix`. `outside` drops the environment directory by location, not by ignore. Nothing calls `checkIgnored`. A `.venv` inside the worktree is dropped because it is the environment, not because git ignores it.

**Core consequence (read in source code).** A stored or adapter closure that names an ignored path makes it untracked. `trackUntracked` then calls `track`, which makes it an extra file the watcher watches, so it keys. So today node:test and pytest key exactly what 009 observation 4 lacked for Vitest. One caveat holds for every runner: a file that fails before it resolves the import records nothing (observation 4's own case).

### Q4. What an adapter needs back

The core already covers three of the adapter's uses:
- the closure: `setClosure` assembles the observed set;
- re-keying on an edit: the key index's reverse map holds every closure path;
- the edit cut: `index.reverse.referencing` and `observedOf` (`edit-cut.ts:57`, `:148`).

So the tracker's `transitive` marks, `takeGrown` and the observed part of `closure()` repeat core work. What stays is in the table below.

| Need | Today | Narrowest form |
| --- | --- | --- |
| Start-up paths in `environment()` (node:test preloads, pytest session) after a restart and in another worktree | Adapter reads its store | The core unions its stored start-up set into the project's `RunnerEnvironment.files`, as `setClosure` does for closures. The adapter keeps its record-time filters (`preloadStatic`, `outside`, the every-file rule) and reports in `environmentObserved` |
| Recreate when another worktree grew that set | `takeRecreate` | The core compares its set with `environmentFiles(project)`, as `rekeyEnvironments` and `unresolvedPreloads` already do |
| `direct` for spawned imports (row 007-56, goal 6) | `graph.recordSpawned`, memory | `ObservedInputs` gains an optional `direct` subset. The core stores it beside the paths and unions it into `affected().direct` for the changed paths |
| pytest's every-file session rule | `graph.affected` with observed edges | This worktree's memory suffices: the rule reads the static closure |

Fallback, if the human keeps the knowledge in the adapter: one read-only view passed at creation, `{ startup(project): readonly RelativePath[]; direct(testFile): readonly RelativePath[] }`. Both are point reads cached on the raw meta string, as `cachedRead` is today. Inferred.

### Q5. Migration and the older daemon

- **Shape (verified by experiment).** The old maps parse as the core's map: probe 4 reads a `nodeTest.observed` value stored under `observed.p` through `ObservedSets.of`. A one-time step can merge each `*.observed.<project>` into `observed.<project>` in one transaction: union, never prune. The step can drop ignored paths unless the human picks O1 (b). The start-up arrays have no core form. They need one project-level key, or the core keeps reading the two old keys as that form. No `user_version` raise is involved: these are meta rows (011 C7).
- **Older daemon reads (read in source code).** A pre-016 core's `setClosure` already reads `observed.<project>` for every project, so it keys node:test and pytest files with the new daemon's paths while the policy holds.
- **Older daemon writes (inferred).** It keeps writing the old keys and storing results under the key it ran under. Suppose a new daemon reads the old keys once and never again. Its key then lacks a path the old daemon observed later, and it can find the old daemon's result at an equal key, although the path's content differs. That is a stale inheritance, the case 003 D3's spare run prevents. So the new daemon must merge the old keys at each refresh (a point query per key, parsed only on change) for as long as an older daemon can share the store. Or the release must make old results unreachable: an adapter-version raise does that.
- **Adapter versions (read in 011 C3).** "A change to what is observed and kept for later keys moves the version of whatever records it." O1, O3 and O8 change what is kept, so `NODE_TEST_ADAPTER_VERSION` and `PYTEST_ADAPTER_VERSION` move under that rule. Every node:test and pytest file then runs once after the release. The raise also settles the mixed-version case, because old keys never equal new ones.

## Recommendation for Squeal

1. Before the slice, take O1 and O8 to the human (spec open question 3). They are the only differences that change a verdict in steady state.
   - For O1, the options are: (a) the core's drop applies to every runner, which accepts observation 4's stale result for node:test and pytest; (b) the core keeps ignored observed paths as extra files for every runner, as it already does for ignored closure paths (004-50), which also closes Vitest's blind spot; (c) a per-runner flag.
   - For O8: exempt module loads from the gate, or accept that `observe.runtimeInputs: false` stops keying computed imports.
2. Raise both adapter versions in the D4 slice (Q5). That covers the mixed-version store and states the one-time re-run.
3. Let the core assemble start-up paths and `direct` marks itself (Q4, first table). The adapter then gets nothing back. Its tracker shrinks to this worktree's record-time filters, and `affected()` keeps only its static graph.
4. Keep the lifecycle poll, but point it at the core's keys for all three runners (O9, O10). Make `unresolvedPreloads` read the start-up set of every runner.
5. Add kit or suite cases for O1 (an ignored file loaded by a computed import, then edited), O8 (the policy off) and 007-56 (restart and second worktree) before the change lands. Probe 1 is the fixture for O1.

## Open questions

1. O1 (a), (b) or (c), and O8: owner the human.
2. O12: are project names unique across runners? Not determined: no check was found in the policy loader, and I did not test one. Owner: the D4 slice.
3. Are both adapter-version raises acceptable under the human's "results survive releases" (2026-10-20)? The raise follows C3's rule, but it re-runs every node:test and pytest file once. Owner: the human, with 011's coordinator.
4. pytest was not run. Its ignore behaviour is read in source code only, because the probe used no Python environment.

## Sources

- Code at `793dfc3d4`: `src/core/scheduler/{observed,store-decision,tiers,record,environment-growth,growth,keying,edit-cut,refinement,revision,bootstrap,link-target}.ts`, `src/core/keys/observed.ts`, `src/core/daemon/{node-test,pytest}-runners.ts`, `src/core/daemon/lifecycle.ts:346`, `src/core/types/{runner,watcher,policy}.ts`, `src/runners/node-test/{adapter,adapter-project,adapter-observed}.ts`, `src/runners/node-test/run/{observed,run}.ts`, `src/runners/node-test/runtime/recorder.cjs`, `src/runners/pytest/{adapter,adapter-observed}.ts`, `src/runners/pytest/run/observed.ts`, `src/runners/pytest/runtime/{squeal_pytest,sitecustomize}.py`, `src/runners/vitest/observe.ts`, `src/runners/observe/inputs.ts`, `src/core/fs/worktree-paths.ts`.
- Specs: 011 `spec.md` C3 (closure, the observed set, ignored paths, adapter versions), C4 (focused tiers), C7, C12, C14; 016 `spec.md` D4; 007 `tasks/007-55-notes.md` (known gaps); 009 `lessons.md` observation 4; board rows 007-47, 007-52, 007-55, 007-56.
- Probe: `probes/observed-paths/probe.ts`, output `probes/observed-paths/output.txt`. Run in `/tmp/obs-probe.j0At` with `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME` set there. No daemon and no store were opened.
