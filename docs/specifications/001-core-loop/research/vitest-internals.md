# Research: vitest-internals

Researcher task for spec 001. Versions examined: **Vitest 5.0.3** (npm `latest` on 2026-10-03), Vite 8.3.2, Node 24.21.0, Linux x64, 24 cores. Vitest 5 requires Node `^22.12.0 || ^24 || >=26`.

Probes: `probes/vitest-internals/` (throwaway, see its README). "src" below means `node_modules/vitest/dist/chunks/index.DpLw24bj.js` in that folder; line numbers refer to that build.

## Questions answered

| # | Short answer |
|---|---|
| 1 | `createVitest('test', { root, watch: false, reporters: [...] })`, then `standalone()`, then `runTestSpecifications(specs)` as often as needed. Runs are serialized. You must call `invalidateFile` yourself or results go stale. |
| 2 | Vite's module graph is empty until something transforms files. The `related` walk transforms (does not execute) every test file and walks importers backwards. It works before any run, costs ~100 ms cold for 50 files and ~2 ms warm. Static collection without running exists: `parseSpecifications`. |
| 3 | Partly. The import closure is available (static from the `related` walk, runtime from the module graph after a run). Setup files, config files and snapshot files are not in a test file's closure and must be added by Squeal. Runtime `fs` reads and `node_modules` are invisible. |
| 4 | `TestCase` via `onTestCaseResult`. Ids are `hash(relative path + project name) + positional index`: stable across runs and worktrees, not stable when tests are inserted or reordered. |
| 5 | Changed imports: graph edges update after `invalidateFile`. Deleted/new test files: need `clearSpecificationsCache()`. Changed config: ignored; needs a new instance. |
| 6 | 50 files: static parse ~35 ms, `related` walk ~100 ms cold, `collectTests` ~340 to 950 ms, full run ~340 to 1000 ms, one-file warm run ~110 to 150 ms. Collect is not cheaper than a run. |
| 7 | Snapshot writes by default, `process.exitCode` mutation, cumulative `testModules`, projects duplicate ids per project, no warm workers between runs, `viteModuleRunner: false` removes the graph. |

## Findings

### Q1. Warm instance with Vitest's watcher off

- `createVitest('test', { root, watch: false, reporters })` then `await vitest.standalone()` (initializes reporters and globs, runs nothing). `verified by experiment` (probe1).
- With `watch: false` Vitest sets `server.watch = null` and closes Vite's chokidar watcher (src 9466, 20650). `VitestWatcher.registerWatcher()` only runs when `config.watch` is true (src 20626). Nothing watches the disk. `read in source code`.
- Run an explicit list: `specs = (await vitest.globTestSpecifications()).filter(...)`, then `await vitest.runTestSpecifications(specs)`. `runTestFiles(paths)` also works. Neither fires `onWatcher*` events. `verified by experiment`.
- The instance stayed alive across 5 consecutive runs in one process. `close()` is one-shot.
- **Without `invalidateFile` an edited dependency gives a stale pass.** probe1: `deep.ts` changed from `base = 10` to `20`, run 3 reported `addBase -> passed` (wrong). After `vitest.invalidateFile(deep)`, run 4 reported `failed`. Vite caches `transformResult` and nothing invalidates it when the watcher is off. `verified by experiment`.
- `runFiles` awaits the previous `runningPromise` (src 21114). Overlapping calls queue; they do not run in parallel and do not cancel. `cancelCurrentRun(reason)` is the only cancel. `read in source code`.

### Q2. Affected test files from the module graph

- Graph state before any run: all three environments (`ssr`, `__vitest__`, `client`) have 0 modules. `verified by experiment` (probe2).
- Vitest's own watcher (`VitestWatcher.handleFileChanged`, src 20365) walks `moduleGraph.getModulesByFile(f).importers` recursively. It only knows files already transformed, i.e. after a run. `read in source code`.
- The `--related` path (`filterTestsBySource` / `getAffectedModules`, src 18584 to 18670) is better for Squeal: it calls `environment.transformRequest()` on each test file in the `ssr` environment, follows `transformResult.deps` and `dynamicDeps`, builds a reverse-edge map and walks back from the changed files. It transforms but **does not execute**. It skips any path containing `node_modules`. Usage: set `vitest.config.related = [abs paths]`, then `await vitest.getRelevantTestSpecifications()`. Vitest resets `config.related` after every run. `read in source code`, `verified by experiment`.
- probe2 results before any run: `deep.ts -> math.test.ts` (transitive), `config.json -> strings.test.ts`, `plugins/p1.ts -> fsread.test.ts` (Vite rewrote the template-literal `import()` into a glob, so variable dynamic imports with a static prefix are tracked), `data/greeting.txt -> []` (runtime `readFileSync`), **`setup-helper.ts -> []`** (imported only by a setup file). `verified by experiment`.
- Collect without running: `parseSpecifications(specs)` parses test files statically (AST) and returns `TestModule`s with ids, names and locations, no worker. `test.each` comes back as one entry, e.g. `1371891694_0_0_1-dynamic`, name `add(%i, %i) = %i`. `collectTests(specs)` imports each test file in a worker and registers tests without running bodies; this expands `test.each`. `verified by experiment`.

### Q3. Dependency closure per test file

| Input | In closure from Vitest? | How to get it |
|---|---|---|
| Static and dynamic imports (project files) | Yes | `related` walk (static) or after a run: walk `importedModules` from the test file in `project.vite.environments.ssr.moduleGraph`. probe2 closure of `fsread.test.ts`: test file, `src/dyn.ts`, `src/plugins/p1.ts`, `vitest/dist/index.js`, a virtual helper. `verified by experiment` |
| `node_modules` | Excluded by the `related` walk; may appear in the runtime graph | Hash lockfile instead. `inferred` |
| Setup files and their imports | No | `project.config.setupFiles`, then their own closure (`setup.ts -> setup-helper.ts` in probe2). Applies to every test file of the project. `verified by experiment` |
| `globalSetup` | No | `project.config.globalSetup`. `read in source code` |
| Config file and its imports | No | `project.vite.config.configFile` plus `configFileDependencies` (probe2: `['vitest.config.ts']`). `verified by experiment` |
| Snapshot files | No | Default `test/__snapshots__/<file>.snap`; `related(.snap)` returned 0 specs. Snapshot content is read fresh each run (editing the `.snap` turned the next run red without `invalidateFile`). `verified by experiment` |
| Runtime `fs` reads, env vars, `tsconfig`, `.env` | No | Not discoverable from Vitest. `verified by experiment` for fs reads, `inferred` for the rest |

The runtime graph is one shared graph per environment, not per test file. A per-file closure is a walk from the test file node. `read in source code`.

### Q4. Per-test result shape

- Reliable hook: reporter `onTestCaseResult(testCase)` per test; `onTestModuleEnd(testModule)` per file; `onTestRunEnd(modules, unhandledErrors, reason)` with **only the modules of this run** (src 20049). `read in source code`, `verified by experiment`.
- `TestCase` fields seen in probe3 (`verified by experiment`):
  - `id: "-1142239720_0_0"`, `name: "assertion"`, `fullName: "failing > assertion"`;
  - `module.moduleId` (absolute path), `project.name` (`""` without projects);
  - `result().state`: `passed | failed | skipped | pending`; `result().errors[]`: `{ name, message, stack, stacks: [{ file, line, column, method }], diff, expected, actual }`;
  - `diagnostic()`: `{ duration, flaky, retryCount, repeatCount, heap, ... }`;
  - `location: { line, column }` **only with `includeTaskLocation: true`** (undefined by default).
- Failure location: `errors[0].stacks[0]` (source-mapped, absolute path). probe3: `fail.test.ts:5:23` for the assertion.
- File-level failures (import error, syntax error) have no test cases. They surface as `testModule.state() === 'failed'` with `testModule.errors()`, e.g. `Cannot find module './deep'`. `verified by experiment`.
- Id formula: `generateFileHash(relativePath, projectName, typecheck)` + `_<index>` per nesting level (`vitest/dist/task-utils.js:156`, runner `t.id = parent.id + "_" + idx`). `read in source code`.
  - Same across two cold instances: true. Same in a copy at a different absolute path: true. `verified by experiment`.
  - Inserting one test at the top shifted every id (`_0_0` became `_1_0`). `verified by experiment`.
  - Same file in two projects gets two different ids. `verified by experiment`.

### Q5. Invalidation cases

| Case | Observed |
|---|---|
| A file whose imports changed (`math.ts` drops `./deep`, adds `./strings`) | Before `invalidateFile(math.ts)`: `related(strings) = [strings.test]`. After: `[math.test, strings.test]`, and `related(deep) = []`. Edges are rebuilt on re-transform. `verified by experiment` |
| Dependency of a changed file | `invalidateFile` invalidates only that file's modules in all projects and environments (src 21442). Importers are not invalidated, which is fine because their transform output does not change. `read in source code` |
| Deleted source file | Next run fails at file level, `Cannot find module './deep'`, with or without `invalidateFile`. `verified by experiment` |
| Deleted test file | Still returned by `globTestSpecifications()` until `clearSpecificationsCache()`. `verified by experiment` |
| New test file | Not returned until `clearSpecificationsCache()`; `project.matchesTestGlob(path)` already returns true. `verified by experiment` |
| Changed config file | No effect: `config.include` unchanged after edit + `invalidateFile`. Config is resolved once. Vitest's watch mode handles this with an internal `_restart` (src 20637). With watch off, Squeal must close and recreate the instance (~50 to 200 ms). `verified by experiment` |

### Q6. Cost on 50 test files

Fixture: 50 files x 6 trivial tests, 25 chained source modules (`gen-fixture50.mjs`). Machine was under load (load average 13 to 26) on the first pass, so ranges below.

| Step | forks, isolate | threads, isolate=false |
|---|---|---|
| `createVitest` | 50 to 190 ms | 50 to 200 ms |
| `related` walk, cold / warm | 95 to 415 ms / 1 to 2 ms | 105 to 300 ms / 2 to 6 ms |
| `parseSpecifications` (static) | 32 to 124 ms | 34 to 78 ms |
| `collectTests` | 770 to 1600 ms | 340 to 1150 ms |
| Full run, 50 files | 760 to 2150 ms | 340 to 875 ms |
| 1 file, warm instance | 134 to 360 ms | 113 to 311 ms |

`verified by experiment`. Collect costs about as much as a run here because tests are trivial; both spawn workers and import modules. With real tests the run will dominate, so the gap grows. `inferred`.

Workers are not kept between `runTestSpecifications` calls: the pool reuses a runner only for consecutive non-isolated tasks in the same queue (src ~11550). The warm part of a "warm instance" is the Vite server and its transform cache, not test workers. `read in source code`.

### Q7. Sharp edges

- **Snapshot writes.** Outside CI the default is `update: 'new'`: a warm instance wrote `test/__snapshots__/strings.test.ts.snap` into the fixture on first run. With `update: 'none'` the test fails and nothing is written (message: "Snapshot `snapshot 1` mismatched"). `verified by experiment`.
- **`process.exitCode`.** Any failing run sets `process.exitCode = 1` (src 20056, 21260). A daemon must reset or ignore it. `verified by experiment`.
- **Cumulative state.** `runTestSpecifications()` returns `state.getTestModules()`: every module ever seen, including stale ones from earlier runs. probe4 got a stale `math.test.ts: failed` back from a run of `new.test.ts` only. Use `onTestRunEnd` modules or filter by the specs you ran. Mixing `parseSpecifications` and `collectTests` in one instance produced duplicated modules in that list. `verified by experiment`.
- **Cache writes into the worktree.** Vitest writes `node_modules/.vite/vitest/<hash>/results.json` under the project root after each run. `verified by experiment`.
- **Projects.** One spec per (file, project); ids differ per project; the `related` walk returns both. Inline projects shared one Vite server in probe6. `verified by experiment`. Projects with their own config file get their own server; `invalidateFile` loops over all projects. `read in source code`.
- **Typecheck mode.** Typecheck specs use pool `typescript` and the id hash includes `__typecheck__`. They run `tsc`/`vue-tsc`, not the module graph. `read in source code`. Not probed.
- **Browser mode.** For a browser project `project.vite` is the browser cluster server (src 20619); the `related` walk still uses its `ssr` environment. Not probed; needs Playwright or WebdriverIO.
- **Coverage.** `coverage.clean` and `cleanOnRerun` wipe the coverage directory on rerun; partial runs produce partial reports. `read in source code`. Not probed.
- **`experimental.viteModuleRunner: false`** runs tests with native `import`. The transform graph Squeal depends on would no longer reflect what ran. `read in official docs` (option JSDoc in `plugin.d.*.d.ts`).
- **`experimental.fsModuleCache`** persists transforms in `node_modules/.vitest-cache`, keyed by a file hash. Off by default. Could shorten daemon cold starts. `read in official docs` (option JSDoc). Not probed.

## Recommendation for Squeal

1. One `createVitest('test', { root, watch: false, reporters: [squealReporter], update: 'none', includeTaskLocation: true })` per worktree. Never run Vitest's watcher.
2. On every file event from Squeal's watcher: `invalidateFile(path)` first; on add/unlink of a file matching `project.matchesTestGlob`, also `clearSpecificationsCache()`; on a change to the config file or `configFileDependencies`, recreate the instance.
3. Compute affected test files with the `related` walk (`config.related` + `getRelevantTestSpecifications()`). It works before any run, without execution, and costs milliseconds warm. Add every test file of a project when a setup file or anything in its closure changes; Vitest does not do this in the `related` path.
4. Build the per-test-file closure from the same transform graph, plus setup files and their closures, `globalSetup`, the config file and its deps, the test file's snapshot file, and the lockfile. Mark the closure as **incomplete by construction**: runtime fs reads and env vars are not visible.
5. Read results from a custom reporter (`onTestCaseResult`, `onTestModuleEnd`, `onTestRunEnd`). Never trust the cumulative `TestRunResult.testModules`. Treat file-level errors as a result for every test previously known in that file.
6. Key check identity on `(project name, relative file path, fullName)`, not on Vitest's id. Use Vitest's id only inside one run. Relativize stack paths before storing.
7. Use `parseSpecifications` to enumerate tests of never-run files cheaply. Do not use `collectTests` as a cheap pre-step; it costs about as much as running.
8. Expect a per-run floor of ~110 to 350 ms on this machine, even for one file, so batching changes into one run is worth it. Reset `process.exitCode` after each run.

## Open questions

- Is `config.related` plus `getRelevantTestSpecifications()` stable public API? It is used by `--related` but the documented surface is the CLI flag. A thin wrapper isolates the risk.
- Does `invalidateFile` behave the same for browser-mode projects? Not probed.
- How much does `experimental.fsModuleCache` cut daemon cold start on a real repo?
- Vitest writes into `node_modules/.vite` in the worktree. Acceptable, or should `cacheDir` point elsewhere?
- How to report `test.each` expansions that `parseSpecifications` shows as one template entry until the file runs.

## Sources

- npm: `npm view vitest dist-tags` on 2026-10-03 (`latest: 5.0.3`).
- `vitest@5.0.3` dist: `dist/node.d.ts`, `dist/chunks/plugin.d.BsjqSb4-.d.ts` (`class Vitest` at line 2300, `VitestWatcher` 2263, `Reporter` 2106, experimental options ~3917 and ~4171), `dist/chunks/index.DpLw24bj.js` (lines cited above), `dist/task-utils.js:156`.
- Vitest docs: https://vitest.dev/api/advanced/vitest, https://vitest.dev/api/advanced/reporters, https://vitest.dev/api/advanced/test-case (not fetched in this task; the shipped `.d.ts` JSDoc was used instead).
- Probes: `probes/vitest-internals/probe1` to `probe6`, `gen-fixture50.mjs`.
