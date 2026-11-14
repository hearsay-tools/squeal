# Loaded modules: select a test file by the modules its last run loaded

**Recommendation.** Squeal can record a test file's loaded set at almost no cost, but selection by that set alone is not safe. On this repository and cezar it would have skipped 11 of 19 new failures in the replay. A safe form narrows only the import-graph part of today's closure and keeps every other input. That form saves 0 to 1% here and pays only in projects with a lazy `import()` fan-out, such as Kody's node-unit project (57% fewer selections).

Researcher, row 022-01, 2026-11-14, 11:00Z to 12:30Z. I read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, ADR 0002, `../status.md`, `015-coverage-complexity/research/{edit-reach,line-level-selection,selection-tools,cezar-selection}.md`, `011-core/research/{central-edits,edit-cut}.md`, the cezar re-run note, and the human's Kody reference (coordinator message, 11:56Z).

Versions examined:
- Squeal `2856d26e8` (0.1.481), with Vitest 5.0.3, Vite 8.3.2 and Node 26.13.0.
- cezar `cc34d00d6`.
- Kody `2b3a0035a` (PR #5108) and its CI map at `518a02f0`, with Vitest 4.1.12.
- Ekstazi `b6ee1f2b` and its ISSTA 2015 paper.
- pytest 9.2.0 and pytest-testmon 2.3.0.

Store copies were taken at 11:56Z with `VACUUM INTO`:
- squeal: 1,831 revisions, coverage records since 2026-11-09 06:46Z.
- cezar: 700 revisions, coverage records since 2026-11-09 08:32Z.

No suite of either repository ran. Probes and their limits are in `probes/loaded-modules/README.md`.

**Reading of the request.** The human pointed at Kody. Kody records, per test file, the repository modules the file's worker evaluated in CI. Its pre-push hook runs the files that loaded a changed module, plus the files that have no record. That is the brief's reading: one set per test file process, from its last run. The other readings exist, but they are different features:
- Per test: testmon's coverage contexts. 015 deferred them.
- "The tests that load module X" as a command: the coverage records can already answer this, as `squeal reach` does.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Closure paths a test file's process never loads | Of today's re-run seconds, 24% (squeal) and 31% (cezar) go to test files that did not load any changed path. Almost all of it comes through non-module inputs: squeal's observed reads 82%, cezar's declared inputs 69%. Import-graph paths that were not loaded (`vi.mock`, untaken `import()`) are 1.2% and 3.6% of it | verified by experiment (store replay) |
| 2 | How to record the set | Vitest: in the worker, from `__vitest_worker__.evaluatedModules`, counting node presence. Squeal's own coverage provider runs there, so no setup file is needed while coverage is on. Cost: 0.3 to 0.4 ms per file for 300 modules. node:test: Squeal's recorder already records each file's process. pytest: a batch of files shares one process, so only import edges plus reachability are order-safe | verified by experiment; read in source code |
| 3 | Soundness | Not sound alone. 20 Vitest fixture cases (19 file edits and one shell variable) changed a result without touching a loaded module: new files that change resolution, file reads, config, environment, child processes and workers, natively required `.cjs`, package internals, snapshots, `tsconfig.json`. Factory mocks, untaken imports and type-only modules are skipped correctly | verified by experiment |
| 4 | Savings and misses | Pure rule (S1): −24% (squeal) and −31% (cezar) of re-keyed seconds, but 11 of 19 real new failures skipped in squeal's chain replay. Safe rule (S2): −0.0% and −0.8%, no misses. Kody: −57% node-unit; workers-unit +25% (the closure misses runtime reach) | verified by experiment (replay) |
| 5 | No recorded set | Fall back to today's closure. Applies to new files, files that never loaded, `isolate: false`, inspector-skipped files, coverage off, a record of another key, or a record with unread or excluded paths. In the chain replay: 4% (squeal) and 9% (cezar) of runs | verified by experiment; inferred rule |

## 1. What today's closure holds that the process never loads

Method: the population replay (`population.mjs`). Each test file's newest coverage record, taken as its loaded set, was compared with its stored closure, against every stored revision's changed paths. Each re-keyed file is weighted by its median recorded seconds. "Not loaded" means re-keyed today, but no changed path is in the record. *verified by experiment.*

| Kind of closure path | squeal: share of not-loaded s | cezar: share of not-loaded s |
|---|---|---|
| observed read (`meta observed.`: data, `package.json`, `src` read by bundling tests) | **81.7%** | 7.7% |
| declared input (policy `inputs`) | 5.9% | **69.1%** |
| child process imported it (`observedDirect`, `observedModules`) | 8.5% | 6.7% |
| setup and config closure (config imports, global setup) | 2.7% | 12.1% |
| import graph, not loaded (factory `vi.mock`, untaken `import()`) | 1.2% | 3.6% |
| other closure paths | 0.05% | 0.8% |
| **not loaded, share of all re-keyed seconds** | 23.8% (30.9% over 979 edit revisions) | 30.9% (40.3% over 503 edit revisions) |

This updates `edit-reach.md`, which found that 33% of pair-seconds do not load the edited file. The not-loaded part is not import edges. It is bundle and package tests that read `src/**` as data, the version-sensitive test that reads every test file, CI-script tests with declared globs, and config imports. These are exactly the inputs a loaded-module set cannot see.

The import graph and the loaded set agree closely here:
- Squeal's import-graph paths that were not loaded are 7.5k of 2.67M re-keyed seconds.
- In the chain replay, untaken dynamic imports cost 9 s in cezar, and statically imported but unloaded paths cost 3 s in squeal.

`edit-reach.md`'s 41% "loaded, nothing called" is loaded, so a module-level set keeps it.

## 2. Recording the loaded set

**Vitest.** *verified by experiment* (`probes/loaded-modules/vitest/`), unless tagged otherwise.

- `globalThis.__vitest_worker__.evaluatedModules.idToModuleMap` holds one node per id the module runner fetched: inlined project files, `mock:<path>` ids, query ids (`a.txt?raw`), and externalized entries.
- It does not hold what Node's own loader loads after an externalized entry. That covers a package's inner files and `require` or `createRequire` of `.cjs` files.
- `vi.resetModules()` sets `evaluated = false` on every node and keeps the node. So a recorder must count node presence, not the flag. *read in source code:* `chunks/utils.DYj33du9.js:27-41`.
- A setup file's `afterAll` records nothing when the test file fails to load. A runner's `onAfterRunFiles` still runs. *read in source code:* `chunks/run.BTlFXlnv.js:4166-4170`.
- With `isolate: true` each file's set is exact, in forks, threads, vmThreads and vmForks. With `isolate: false`, each set is the union of every earlier file in the same worker. It never undercounts, but it depends on order.
- Vite's server module graph is one per environment, so it cannot say which file loaded what.
- Cost: a 300-module fixture, 20 files, load 10.7 to 12.9. Reading the map took 0.31 to 0.40 ms per file. Wall time with the recorder was 2,285 ms against 2,528 ms without it, inside the noise.

**Squeal's coverage records as the set** (*read in source code*: `src/core/code/coverage/provider.mjs`, `src/runners/vitest/coverage.ts`, `record.ts`). A record holds the transformed project files that V8 saw run in the test file's worker.

The records exist. Coverage has been on by default since 2026-10-28: 113,215 records for squeal and 137,389 for cezar. The replays use them. They differ from a loaded set in four ways:
- **`coverage.exclude` removes paths.** Squeal's own config excludes `test/**`, so its records hold no test helper. *verified in the store.*
- No record is made under `isolate: false` or for inspector-skipped files (`skip.json`). A batch of several files is dropped.
- `node_modules`, `?raw` ids and natively required `.cjs` files are not in a record.
- With `coverage.children` (off by default), the records of child processes are merged in, which `evaluatedModules` never sees.

**Kody's recorder against Squeal's** (the coordinator's point a). Kody adds a setup file that reads `evaluatedModules` in `afterEach` and `afterAll` and stores the set in task meta. A reporter keeps repository paths only and leaves a test unmapped when its own path is missing. *read in source code:* `tools/vitest-module-map-setup.ts`, `tools/vitest-module-map-reporter.ts`.

Squeal runs Vitest in its daemon process, so the adapter cannot read worker state directly. Its coverage provider, however, already runs inside the worker on every supported Vitest:
- The provider is loaded by path, and its header names Vitest 4.1.10 and 5. *read in source code.*
- Squeal's peer range is `>=5`.
- Kody shows that the same field exists on 4.1.12.

So, while coverage is on, `takeCoverage` can read `evaluatedModules` with no setup file. When coverage is off, `isolate: false` is set, or the file is skipped, there is no worker hook. The adapter then needs an injected setup file or a runner hook, the runner hook so that load failures still record.

One more field is available. `takeCoverage` also receives `moduleExecutionInfo` (`chunks/coverage.S6Dao4g-.js:15`). The per-file loop resets only `evaluatedModules` (`chunks/base.DhkQeZwd.js:82-85`), so that map is not a per-file set without a reset. *read in source code, not tested.*

**node:test.** *read in source code; verified by experiment* (`probes/loaded-modules/node-pytest/`).

- Squeal runs one `node --test <file>` per test file, so sets never mix (`src/runners/node-test/run/run.ts:98-145`).
- Its `recorder.cjs` uses a synchronous `module.registerHooks` resolve hook (`:88-114`). It already records each process's resolved modules, which feed `observed` paths that are merged into the closure.
- The sync hook sees CommonJS, ESM, type-stripped `.ts`, worker threads and child processes. The async `module.register` misses `require` chains and costs +50 to +73%.
- Squeal's recorder costs +6% at 300 modules and +16% at 1,500 (load 12.6 to 14.8). The cost is the append per edge; one write at exit costs +2% or less.

**pytest.** *read in source code; verified by experiment.*

- Squeal runs files in batches of five per process (`src/runners/pytest/run/run.ts:71`). Its plugin records import edges, already-imported modules included, and computes reachability from the file and its `conftest.py` files.
- A `sys.modules` difference or a first-import hook depends on file order: the second file misses shared modules.
- Edges plus reachability are order-safe but over-attribute.
- One miss no import hook catches: `import pkg` followed by reading `pkg.deep.D`, which works only after another file imported `pkg.deep`.
- testmon 2.3.0 switches Coverage.py contexts per test and drops lines run during collection (`testmon_core.py:555-565, 629`). It says it does not track "static files" (https://www.testmon.org/).

## 3. Soundness

Each case is a Vitest 5.0.3 fixture: run, edit, run again (`probes/loaded-modules/vitest/results.md`). Each changed a result while the edited path was not in the run-1 set. *verified by experiment.* The last column says what in today's closure catches it, from reading the fixture.

| Escape | Cases | Today's closure |
|---|---|---|
| A new file changes resolution: `util.ts` beside `util/index.ts`, `util.js` beside `util.ts`, a new glob match, a new `__mocks__/dep.ts`; a pytest `util.py` shadowing; a new `__init__.py` | 1a to 1d; pytest shadow | resolution candidates and glob patterns (graph D3, D4); `__mocks__` not determined |
| A file read outside the module system: `fs.readFileSync`, the `.snap` file | 3a, 9 | observed reads (snapshots not checked) |
| Environment: config `test.env`, `.env` through `import.meta.env`, the shell | 4a to 4c | config closure; `.env` and the shell not determined |
| Child processes and `worker_threads` | 5, 11f | `observedDirect`, `observedModules` |
| Config: `define`, `globals`, `globalSetup` `provide` | 6b to 6d | config and global-setup closure |
| Node's own loader: a package's inner files, `require`, `createRequire`, `.cjs` required by an imported `.cjs` | 10a, 11a to 11c | packages by lockfile and install; literal `require` |
| Transform and resolution inputs: `tsconfig.json`, `package.json` `imports` | 11d, 11e | config dependencies and packages, not checked |

The set does catch, or correctly skips, these cases:
- It catches every edit to a module the runner evaluated, including setup files and their imports (6a), `importOriginal` (2b), automocks (2c, as `mock:` ids), `?raw` (3b), and a branch flipped in a loaded module (7b).
- It skips the edits that cannot change the result: a factory-mocked module (2a), an untaken `import()` (7a), and type-only imports (8a to 8c).

**Kody's escapes, against these cases** (the coordinator's point b). *read in source code at `2b3a0035a`*.

- `repoModulePath` drops `node_modules`, and no lockfile is mapped. That is case 10a. Kody's hook answers package, lockfile, wrangler, migration and vitest-config pushes with a full run instead (`tools/git-hook-checks.ts:438-449`).
- File reads are not mapped (3a, 9). The Kody replay found `tools/check-migrations.node.test.ts:403-407`, which copies a fixture directory at runtime.
- Setup files are in the set (6a), but `globalSetup` and the config are not (6b to 6d). The config also loads `packages/worker/.env` with dotenv (4b).
- `changedModulePaths` hashes mapped paths only, so a new file that changes resolution is never "changed" (1a to 1d).
- The hook skips unit tests when every pushed path is documentation-only. Yet node-unit tests import 68 `docs/` markdown files and 73 blog posts. A guide-only push would run none of them. *inferred; it did not happen in the 50 commits.*
- The workers pool is not an escape for the set: the set is wider than the closure there (section 4).

**Ekstazi and testmon.**
- Ekstazi calls a selection safe when it "includes all tests whose behavior may be affected by the changes". It claims safety "for any code change and any change on the file system". It gives no formal proof and relies on collecting every class used and every file read, with checksums (paper, sections 1 and 3). Its file recording is a `SecurityManager.checkRead` hook marked `@Research` (`io/FileRecorder.java`).
- testmon tracks executed code blocks and excludes static files.
- So both argue safety from complete dependency collection. Squeal's closure already collects the non-module part (observed reads, child modules, declared inputs, config closure, resolution candidates). A loaded set may replace only the in-process module part.

## 4. Savings and misses

**Chain replay** (`replay.mjs`): real runs in worktrees whose revisions are all stored. Each run is decided by the record of the previous run's key. *verified by experiment.*

| | squeal | cezar |
|---|---|---|
| closure-driven runs with a prior record | 4,008 runs, 19,352 s | 1,022 runs, 4,543 s |
| S1 (pure) skips | 706 runs (17.6%), 3,477 s (18.0%) | 610 runs (59.7%), 2,535 s (55.8%) |
| new failures (passed before, fail now) | 19 | 3 |
| new failures S1 would skip | **11** | 1 |
| S2 skips / misses | 1 run, 0 s / 0 | 3 runs, 2 s / 0 |

The 11 are real:
- 8 are bundle-equality failures ("cli/squeal.mjs differs from the build") in `test/harness/{plugin,pi/package,opencode/package,codex/packaging/runtime}.test.ts`. They are reached through declared `src/**/*.ts`.
- 3 are `test/version-sensitive.test.ts`, which reads other test files as data.

cezar's one skipped failure is a hook timeout, probably load.

**Population replay** (section 1's method), as re-keyed recorded seconds summed over revisions:

| | today | S1 (pure) | S2 (safe) |
|---|---|---|---|
| squeal, 1,831 revisions | 2,670,673 s | 2,036,140 s (−23.8%) | 2,670,767 s (+0.0%) |
| squeal, 979 edit revisions | 1,128,001 s | 779,781 s (−30.9%) | 1,128,517 s (+0.0%) |
| cezar, 700 revisions | 1,911,283 s | 1,320,044 s (−30.9%) | 1,896,180 s (−0.8%) |
| cezar, 503 edit revisions | 882,151 s | 527,024 s (−40.3%) | 875,634 s (−0.7%) |

"S1 adds" means loaded paths that are outside today's closure. It is 0.2% (squeal) and 0.1% (cezar). Most of it is a record and a closure taken from different branches.

**Kody** (the coordinator's point c). One CI map against an emulated static+dynamic+setup closure of the same tree, replayed over 50 commits from 2026-11-12 to 11-14 (`probes/loaded-modules/kody/results.md`). *verified by experiment.*

- Static resolution left 3 of 30,546 node-unit specifiers and 5 of 11,414 workers-unit specifiers unresolved.
- node-unit: the observed set selected 11,948 tests and the closure 27,956 (−57%; median per commit 101.5 against 946).
- workers-unit: the observed set selected 3,572 and the closure 2,868. The closure missed 970 selections in 30 commits: the Cloudflare pool loads the worker entry at runtime, so 116 of 147 tests evaluate it without an import edge.
- PR #5108's table reproduces: `capabilities.ts` 16 against 946 in node-unit; `search-tool-runner.ts` 116 against 8 in workers-unit.
- A static-only graph, without dynamic edges, under-selects in 34 of 50 commits.

## 5. A test file with no recorded set

It falls back to today's closure. That is Kody's "unmapped" rule (`selectObservedTests`, `tools/test-module-map.ts:168-194`) and testmon's rule for new tests. *inferred.* The cases:
- A new or never-run file.
- A file that failed to load: the coverage provider and a setup-file recorder give no set, a runner hook does.
- `isolate: false`, an inspector-skipped file, or coverage off.
- A node:test project with `--test-isolation=none`.
- A record of a key other than the previous run's.
- A record with `unread` paths, or a path that `coverage.exclude` drops.

A record stores a blob per source. So "a loaded path changed" can be checked against the current files, without the revision chain, as Kody and Ekstazi do by checksum. *read in source code.*

Measured frequency:
- Chain replay: 3.9% (squeal) and 9.3% (cezar) of closure-driven runs had no prior record.
- Population: 30 of 1,860 squeal test files had none (e2e and removed files). 170 of 2,180 cezar test files had none, and 128 of those last ran before coverage began.

## Recommendation for Squeal

1. Do not offer the pure rule as a replacement strategy. Here it trades 24 to 40% of re-run seconds for skipped real failures, and the saved seconds are exactly the non-module inputs that it cannot see.
2. If a strategy option is added, the safe form is: replace only the import-graph part of a test file's closure with the record of its previous key, and keep the rest of today's closure. The rest means resolution candidates, glob patterns, listings, setup and config, observed reads, child modules, declared inputs and packages. A file without a usable record falls back.
   - Squeal and cezar would gain about 1% from this.
   - Projects with lazy `import()` fan-outs would gain much more, as Kody's node-unit project shows.
   - Squeal can measure the gain per project from its own store before anyone switches: import-graph paths that no record loaded, weighted by seconds.
3. Consider the union direction too. A record path that is outside the closure is runtime reach that today's key misses: Kody's workers pool, computed `import()`. Adding record paths to the closure makes today's rule safer. *inferred; not measured on squeal or cezar beyond 0.1 to 0.2%.*
4. Record from the worker with node presence, `mock:` ids by file, and setup files. Keep `coverage.exclude` out of the selection set. `squeal.config.json` here excludes `test/**`.

## Open questions for the human

- Is a strategy that saves about 1% on Squeal and cezar worth an option, given that its value lies in projects shaped like Kody's? The `selection-option.md` topic covers the cost of an option.
- Would the human accept Kody's trade-off: a skipped test is caught later by a full CI run? Squeal reports current and stale results, so a skip would leave a stale result. 015's `selection-tools.md` describes that debt.
- Not determined: whether the `__mocks__` lookup, `.env` files and the shell environment reach today's key. They are escapes for both rules.

## Sources

- Squeal `2856d26e8`:
  - `src/runners/vitest/{graph,loads,dynamic,environment,project,coverage}.ts`
  - `src/core/code/coverage/{provider.mjs,record.ts,parts.ts,types.ts}`
  - `src/core/store/{schema,import-edges}.ts`
  - `src/core/keys/{closure,observed,modules}.ts`
  - `src/core/types/policy.ts:461` (`children: false`)
  - `src/runners/node-test/run/run.ts`, `src/runners/node-test/runtime/recorder.cjs`
  - `src/runners/pytest/run/run.ts`, `src/runners/pytest/runtime/squeal_pytest.py`
- Vitest 5.0.3 `dist/`: `chunks/base.DhkQeZwd.js`, `chunks/utils.DYj33du9.js`, `chunks/run.BTlFXlnv.js`, `chunks/coverage.S6Dao4g-.js`, `module-evaluator.js`, `chunks/worker.d.Bt2A2mmi.d.ts:246`.
- Kody `2b3a0035a` (https://github.com/kody-hq/kody/pull/5108):
  - `tools/{vitest-module-map-setup,vitest-module-map-reporter,test-module-map,vitest-related-observed,git-hook-checks}.ts`
  - `vitest-shared.ts`
  - artifacts `test-module-map-*` of run 43588774129
- Ekstazi https://github.com/gliga/ekstazi `b6ee1f2b`; Gligoric, Eloussi, Marinov, "Practical Regression Test Selection with Dynamic File Dependencies", ISSTA 2015, https://users.ece.utexas.edu/~gligoric/papers/GligoricETAL15Ekstazi.pdf.
- testmon https://www.testmon.org/ and pytest-testmon 2.3.0 (https://pypi.org/pypi/pytest-testmon/json).
- Store copies of `~/projects/{squeal,cezar}/.git/squeal/{store,code}.sqlite`, taken 2026-11-14 11:56Z.
- Probes: `probes/loaded-modules/` (README, `replay.mjs`, `population.mjs`, `vitest/`, `node-pytest/`, `kody/`).
