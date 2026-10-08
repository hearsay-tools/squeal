# Research: observed-runtime-inputs

Date: 2026-10-08. Researcher task 001-128, from `lessons.md` defect 28's cause and the human's goal that Squeal maintains the list of files a test reads at run time, so nobody writes `inputs`. Probes: `probes/observed-runtime-inputs/` (throwaway).

Evidence tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred. Versions: Vitest 5.0.3 and 4.1.11 on the fixture; `cezar` at `1c97556a` (a fresh clone of `/home/agent/projects/cezar`, `npm ci`, Vitest 4.1.10, 640 test files in 4 projects); Node 24.21.0, with 22.23.3 and 24.15.0 where named; Linux, 24 cores, load 2 to 40 from other sessions.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | How Squeal observes, per test file, the project files a run reads and the scripts it spawns | One `--require` recorder in every Vitest worker. It wraps `fs`, `child_process` and `worker_threads.Worker`, adds a `module.registerHooks` resolve hook, and re-injects itself into every child's env at spawn. Forks and threads, Vitest 4.1.11 and 5.0.3, Node 22 and 24. On `cezar`, `runner-shutdown-parity.test.ts` shows `packages/cezar/scripts/mock-cursor-print.mjs` (read, executed as entry). Unseen: non-Node children's own reads, native code (`node:sqlite`), the Vitest main process (`globalSetup`, plugins). **[exp]** |
| 2 | The `node:test` observed closure, and whether one mechanism serves both runners | 003 records only `registerHooks` resolve edges, one process per file, and stops at a spawn (decision 3). The Q1 recorder is a superset of it. One file serves both runners; only attribution differs. **[src][exp]** |
| 3 | Attribution, filtering, writes | `globalThis.__vitest_worker__.filepath` in a worker, and an env variable the recorder sets in each child and thread. On `cezar` 0 in-worktree events were unattributed. Filter: inside the worktree, outside `node_modules`, not in the file's import graph, not its snapshot, not written by the run. Ignored paths are a blind spot. **[exp]** |
| 4 | Soundness and keys | 003's model holds: union the observed paths into the shared store, make them closure paths, and key their hashes. Two changes: key a listed directory by its entries, and store the first result under the key that includes what it observed. `inputs` stays for the blind spots. **[src][inf]** |
| 5 | Cost on `cezar`; how many closures grow | 153 of 640 test files (24%) read project files outside their import graph; 114 of them execute a project script. 1,092 distinct paths. Per call 3 to 6 µs, per process about 2 ms; per-file duration +0 to +10% at p50. Whether the recorder adds timeout failures under contention is not determined (F5). **[exp]** |

## Findings

### F1. The mechanism, and where it reaches (Q1) **[exp]**

`recorder/observe.cjs` (about 110 lines) records `read`, `stat`, `list`, `write`, `module` (resolve hook), `entry` (`process.argv[1]`) and `argv` (an absolute argument naming an existing file). It wraps the sync, callback and promise forms of `fs`, `ChildProcess.prototype.spawn` (which every async spawn, `exec`, `execFile` and `fork` goes through), `spawnSync`, `execSync`, `execFileSync`, and the `Worker` constructor. It then calls `module.syncBuiltinESMExports()`, so `import { readFileSync } from 'node:fs'` sees the wrappers.

Fixture (`fixture/`, five test files), each seen per test file, identically under forks and threads, `isolate` true and false, Vitest 5.0.3 and 4.1.11:

| Read | Seen |
|---|---|
| `readFileSync`, `fs/promises.readFile`, `createReadStream`, `import * as fs` | yes |
| `existsSync` of a missing file | yes, as `stat` |
| `readdirSync`, `fs.globSync` (via `readdirSync`) | yes, as `list` of the directory |
| `FileHandle.readFile` | yes, through its `open` |
| a `node` child with inherited env; with `env: {}` and `detached`; its grandchild spawned with `env: {}` again; `execFileSync` | yes: entry, imports and reads |
| a `worker_threads` Worker | yes. Attributed once the recorder carries the test file into the Worker's env |
| a shell script child (`execSync('scripts/run.sh')`) | the script path only, not what `cat` reads inside it |
| `node:sqlite` opening `data/db.sqlite` | **no**: native code opens the file |
| a computed `import()` in the test | **no** in the worker, because Vite loads it. After the run Vite's module graph holds the target with the importer edge in `ssr` (`graphcheck.mjs`), but Squeal's walk reads `transformResult.deps`, which lacks it (`src/runners/vitest/graph.ts`) |

Delivery into the worker:

- **Root `execArgv`.** On the fixture (one project), passing `execArgv` to `createVitest` works. On `cezar`, whose projects each have their own config file, it reached no worker: 0 events. Vitest 5 builds each task's argv as `[...options.execArgv, ...conditions, ...project.config.execArgv]` from the pool's own options and the project's resolved config (`chunks/index.DpLw24bj.js` 11744 to 11752) **[src]**.
- **Per-project `execArgv`, or `NODE_OPTIONS` in the worker env.** Appending `--require <recorder>` to each resolved `project.config.execArgv` after `standalone()` works on `cezar`, but it mutates resolved config. `NODE_OPTIONS` also works: either in the daemon's `process.env`, or as the public option `createVitest('test', { env: { NODE_OPTIONS } })`. That option reached every `cezar` project, because Vitest spreads `{...process.env, ...options.env, ...ctx.config.env, ...project.config.env}` into each worker (line 11725). A project's own `env.NODE_OPTIONS` would override it **[src][exp]**.
- **Threads.** Vitest's threads pool passes `execArgv` and `env` to `new Worker` (it already uses `--require` there for its own warning filter). A Worker honours a `--require` given in its `env.NODE_OPTIONS` on Node 22.23.3, 24.15.0 and 24.21.0 **[exp]**.

Child processes are the part that needs the wrapper. `execArgv` reaches threads, not children. Without re-injection, a child that inherits env saw only the argv heuristic, and a child with `env: {}` saw nothing. With it, both were fully observed **[exp]**. `cezar` is the case: the runner spawns the mock as `process.execPath mock-cursor-print.mjs`, `detached`, with an allowlisted env (`cursor-print-process.ts` 33 to 41; `agent-env.ts` `curateEnv`). `NODE_OPTIONS` passes that allowlist through its `NODE_` prefix (line 139), but a `SQUEAL_*` variable would not. Injecting at the spawn sets every variable the recorder needs, whatever the caller passed **[src][exp]**.

This differs from `per-package-keys.md` F1, which saw neither a Worker nor an `env: {}` child. The delivery decides it: a resolve hook registered in the main thread only, with `NODE_OPTIONS` merely inherited, against a `--require` preload that runs in every thread and re-injects at each spawn **[inf]**.

On `cezar`, `runner-shutdown-parity.test.ts`, whose Vite import graph holds `harness-parity.testkit.ts` but none of the mocks, observed `scripts/mock-cursor-print.mjs` (stat, argv, entry, module, read). It also observed the six other mocks and `scripts/pi-retry-degraded-service.mjs` (argv). All seven cases passed **[exp]**.

### F2. `node:test`, and one recorder for both (Q2) **[src][exp]**

003's recorder (`src/runners/node-test/runtime/recorder.cjs`) is a `registerHooks` resolve hook that appends `(parent, url)` edges to `<SQUEAL_NODE_TEST_GRAPH>-<pid>.ndjson`. It loads as the first `--require`, is prepended to a `NODE_OPTIONS` that holds a `--require`, and skips Node's internal hooks thread. `observedClosure` (`run/observed.ts`) takes reachability from the test file's URL, splits off the preload roots, and keeps project paths outside `node_modules`. `Observed` (`adapter-observed.ts`) merges, never removes, per project into `nodeTest.observed.<project>` and `nodeTest.observedPreloads.<project>` (`src/core/daemon/node-test-runners.ts`), and the paths enter `closure()` and the stored closure in one transaction. It sees no `fs` read, and nothing past a spawn: decision 3 of 003 says "`NODE_OPTIONS` would reach unrelated processes". Its variable is `SQUEAL_*`, so `cezar`'s allowlist would drop it.

The Q1 recorder keeps 003's resolve hook and adds `fs`, spawn re-injection and Worker attribution. Each runner differs only in two places. Attribution: `node:test` runs one process per file, so the adapter sets the test file at spawn and every descendant inherits it, while Vitest reads the worker state per event. Delivery: `node:test` uses today's first `--require`; Vitest uses per-project `execArgv` or `NODE_OPTIONS` in its worker env. Re-injection reaches only descendants of a test process, which answers decision 3's concern for everything except long-lived descendants (F4) **[inf]**.

### F3. Attribution and noise (Q3) **[exp]**

- **Attribution.** Vitest sets `workerState.filepath` before running a file's setup files and the file (`chunks/base.DhkQeZwd.js` 87) **[src]**. Runtime reads of a setup file therefore count for every file of the project, which is correct for a per-file key. Under `isolate: false` a callback a previous file left running would be misattributed **[inf]**. On the full `cezar` run, 0 in-worktree events lacked a test file.
- **Filter.**
  - Paths outside the worktree and under `node_modules` are dropped. Reads of `node_modules` belong to D3's package keys, and that hand-built `fs` path is today an accepted miss.
  - Paths in the file's Vite import graph and its snapshot path are dropped, since they are already in the closure.
  - A path the run wrote is dropped. On `cezar`, two files wrote into the worktree: `notes.md` at the root, and `.ai/qa/failures/...`.
  - `spawn` with a bare command (`git`, `sed`, a shell string) is noise. Only `entry` and `argv` with an existing file count.
- **Ignored paths.** Four server tests `stat` `packages/cezar/web/dist/index.html`, and four `stat` `.agents/skills`, both gitignored. The watcher does not track them, so a result that depends on whether the web build exists cannot be keyed. Report it, do not key it.

### F4. Soundness and keys (Q4) **[src][inf]**

- **Store and re-key.** 003's model carries over: per project and test file, a shared merged set whose paths join `closure()` and the stored closure. A change re-keys through the reverse index `path -> test files`, and an edit's re-key runs in D5's first group. Editing `mock-cursor-print.mjs` would re-key `runner-shutdown-parity.test.ts` and 25 other files (fan-out in F5).
- **Directories.** A `list` must key the directory's entry names (non-recursive; a walk lists each subdirectory). Otherwise adding a file is missed for a test that lists a tree and then reads each entry. `history-readers.test.ts` (757 paths) and `design-guardian.test.ts` (677) do exactly this. A `stat` keys like D3's absent candidates. A missing path hashes as absent, so creating it re-keys.
- **The first run.** A file that has never run under the recorder has only its static closure. Its first result is stored under a key without the observed paths, and 003 keeps it current "only where the observed paths are still unknown". To avoid both an extra run and a stale window in other worktrees, store the result under the key that includes what it observed, using the hashes at the tier's revision. If an observed path changed during the tier, discard and re-queue, as D5's stability check does for closure paths. A recorder version raises the adapter version, so earlier passes run once (on `cezar`, the suite once, about 9 minutes).
- **A read that disappears.** Union never shrinks, so it over-runs but never misses. An exact per-result trace (Ninja depfiles, Shake) would store each result's own observed set and verify it at lookup: a second lookup level and a schema change. Not needed to fix defect 28.
- **`inputs`.** Remains an override for what observation cannot see: non-Node children's reads, native addons, `globalSetup` and plugin reads in Vitest's process, ignored paths, outside-worktree state. An exclusion override is worth considering for scanner tests, whose large sets re-run on every source edit.
- **Long-lived descendants.** A daemon a test starts keeps `NODE_OPTIONS=--require <recorder>`. A Node it spawns after the recorder file is gone fails to start (`Cannot find module`), so the recorder path must stay stable for the daemon's life **[inf]**.

### F5. Cost on `cezar` (Q5) **[exp]**

- **Growth.** Full suite with the recorder: 153 of 640 test files observe project paths beyond their post-run Vite import graph (the union over every Vite environment; `web` re-run for that). 146 of them read content, 114 execute or pass a project script, and 7 only stat or list. There are 4,573 file-path pairs and 1,092 distinct content paths. Additions per file: p50 5, p90 30, max 757.
- **Fan-out.** `packages/cezar/package.json` is read by 84 files, `src/git-worktree-lock-helper.ts` is spawned by 72, `scripts/mock-claude.mjs` by 55, and `mock-cursor-print.mjs` by 26. Of `packages/cezar/src` modules, 254 are observed by at least one file, with a median of 6 per module, mostly whole-tree scanners. Each source edit therefore adds about 6 short files to its run.
- **Overhead.** 3 to 6 µs per wrapped `fs` call (`bench.mjs`: `readFileSync` 11.1 to 17.0 µs, `statSync` 3.5 to 6.3 µs) and about 2 ms per process start. The full run started 7,805 recorded processes.
- **Duration.** Full suite: 561 s with the recorder (load 20 at start) against 517 s without (load 5). Summed per-file time was +6.8%, and the per-file ratio p50 was 0.92, so load dominates. A/B on `packages/cezar/src/core/` (78 files, alternating). Round 1 at load 30: per-file ratio p50 1.10 (p25 1.03, p75 1.30), summed +15.3%. Round 2 at load 2 to 6: p50 1.00 (0.94, 1.07), summed +3.4%. Wall time is set by `harness-parity.test.ts` alone (about 500 s), so it is no measure.
- **Results.** Full suite: 640 of 640 passed both ways. In the A/B, one file failed in each recorder round and none in either round without it. Round 1: `workflow-autonomous-parity.test.ts`. Round 2: `workflow-followup-parity.test.ts`, codex `hold-done` reporting `driveRun ... never settled` (a 30 s deadline in `harness-parity.testkit.ts` 860). Run alone, three rounds each way, both files passed all six times (load 11 to 59). **Not determined** whether the recorder raises timeout failures in crowded runs: 2 of 3 recorder runs against 0 of 3 is suggestive but not reproduced. Squeal treating a recorder-only failure as the agent's would break its promise.
- **Volume.** The probe logged 623 MB, almost all `node_modules` module paths. In-worktree events numbered 184,306 lines (68 MB in this verbose format), so a recorder must filter in-process and dedupe per process.

## Recommendation for Squeal

Build it, for both runners, as one recorder: `runtime/recorder.cjs` grown by F1's `fs`, spawn and Worker wrappers, filtering in-process to the worktree outside `node_modules`.

- **Vitest delivery.** Prepend `--require <recorder>` to `NODE_OPTIONS` through `createVitest`'s `env` option, merged with the daemon's own value. Fall back to each project's resolved `execArgv` where a project sets `env.NODE_OPTIONS`. Both work in both pools.
- **Child delivery.** Re-inject at every spawn into whatever env the caller passed.
- **Storage.** Generalize 003's `nodeTest.observed.<project>` to a runner-neutral key, with a union and closure paths. Add directory listings as keyed entries, and store the first observed result under its full key.

Blind spots to state in status, where today it says "static imports plus declared inputs":

- what non-Node children read;
- native file access;
- the Vitest main process (`globalSetup`, plugins);
- ignored and outside-worktree paths;
- an async `--loader`'s own thread (003);
- a test's first run, before anything is observed.

Cost on `cezar`:

- 153 of 640 files (24%) gain closure paths, about 4,600 entries in the shared store;
- a source edit adds about 6 short scanner runs, and a mock edit 26 to 55 files;
- the suite re-runs once at the adapter-version bump;
- per-file time rises 0 to 10% at p50;
- an open risk of extra timeouts under contention (open question 4).

Spec sentences it changes:

- **D3 "Closure":** add "and the project paths the file's runs were observed to read, stat, list, load or execute (D4), shared per project across worktrees and merged". The status method becomes "static imports, observed runtime reads and declared inputs".
- **D4:** add an `observe` bullet: the delivery above, attribution by `__vitest_worker__.filepath`, and observed paths returned with `run()`.
- **D5:** the stability check covers newly observed paths, and the first observed result is stored under its full key.
- **003:** decision 3 and D5's "not observed past the spawn" are reversed.

Board row done-when:

1. On a fixture under Vitest 5 forks and threads and `node:test`, a test that reads a data file, spawns a `node` script with `env: {}` (which spawns a grandchild), and starts a Worker re-runs when any of those files changes, with no `inputs`. A listed directory gaining a file re-runs its test.
2. On a `cezar` clone, with no `inputs`, editing `scripts/mock-cursor-print.mjs` re-keys and runs `runner-shutdown-parity.test.ts` (cursor S26 to S28 among them) at the next tier. A second worktree with the old mock does not inherit the new result.
3. Across three full-suite runs each way on `cezar`, no file fails only with the recorder, or each such failure is shown to be load.
4. Status names the blind spots.

## Open questions

1. Whether to key large scanner sets as they are (correct, about 6 extra runs per edit on `cezar`) or let policy exclude them. A product call.
2. Whether the union should ever prune. A per-result trace is exact but changes the store. Not needed for defect 28.
3. Ignored-path reads (`web/dist`): key the existence of a built artifact, or only report it.
4. Whether the recorder's added latency turns deadline-bound tests flaky under contention (F5). Decides whether it must run with fewer synchronous writes (batch per process, flush at exit) or only on files known to spawn or read.
5. macOS: not run. `registerHooks` and the wrappers are platform-neutral JavaScript **[inf]**.

## Sources

- Squeal: `src/runners/node-test/runtime/recorder.cjs`, `src/runners/node-test/run/observed.ts`, `src/runners/node-test/adapter-observed.ts`, `src/core/daemon/node-test-runners.ts`, `src/runners/vitest/graph.ts`; `docs/specifications/003-node-test-runner/spec.md` D3, D5, open question 3; `status.md` 003-24, 003-28; `research/per-package-keys.md` F1.
- Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js` (pool env and `execArgv` 11718 to 11752, forks `fork()` 11096, threads `new Worker` 11202, `resolveOptions` 11815), `dist/chunks/base.DhkQeZwd.js` 87, `execArgv` docs in `dist/chunks/plugin.d.BsjqSb4-.d.ts` 3607; Vitest 4.1.11 behaves the same (`reporters.d.DtoKVV2s.d.ts`).
- `cezar` `1c97556a`: `packages/cezar/src/core/runner-shutdown-parity.test.ts`, `harness-parity.testkit.ts` 411, `cursor-print-process.ts` 33 to 41, `agent-env.ts` 134 to 139 and 333 to 400.
- Probes: `probes/observed-runtime-inputs/` (`README.md` lists each script); raw full-suite JSON was kept outside the repository (`tmp/full-*.json`, about 5 MB each).
