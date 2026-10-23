# 015-01: coverage from Squeal's own runs

Researcher, 2026-10-23. Brief: `coverage-collection-brief.md`. Probes: `probes/coverage-collection/` (throwaway; every run under `/tmp`, no daemon, no agent session). Versions examined: Vitest 5.0.3, `@vitest/coverage-v8` and `@vitest/coverage-istanbul` 5.0.3, Node 24.21.0, coverage.py 7.17.0 with pytest 9.1.1 on Python 3.12.3, this repository at f6f44e03.

The parent's note of 2026-10-23 (the human: "the code can squeal as well, not just tests", a feasibility question, open question 1 in `../status.md`) is answered for coverage under Q6: where a per-function state with transitions holds and where it does not.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Warm instance, per test file | Yes, v8 and istanbul, with or without a `coverage` section. One payload per worker batch, one file per batch unless `isolate: false`. Thresholds change no state but set the daemon's exit code. A provider of Squeal's own needs no package. | experiment; source |
| 2 | Mapping to source | The provider maps v8 ranges through the transform's source map to istanbul function, branch and statement records. Mapped path-relative records match across roots; raw ones do not. | experiment |
| 3 | node:test, pytest | node:test: `NODE_V8_COVERAGE` per process is per file, offsets index the `.ts` source. pytest: coverage.py contexts work, except import-time lines across a batch. | experiment |
| 4 | Cost | v8 +8% CPU, wall time within noise. istanbul +14% CPU, +28% wall. A compact record is 9 KiB per test file. | experiment |
| 5 | Fidelity | v8 is visible through `node:inspector`: one PASS -> FAIL. istanbul is visible in globals and function source. | experiment |
| 6 | Sharing by key | Yes, a mapped record keyed like the result. 0 differences over 2 runs. A source's coverage is exact only while all its loaders are current. | experiment; inferred |
| 7 | Line-level selection | 259 runs against 899 at file level over 76 edits, 71% fewer, on a 30-file sample; not sound for every program. | experiment (sample) |

## Findings

### Q1. Vitest warm instance

- **Per-file payloads exist** (verified by experiment, `warm.mjs`; read in source, `index.ggMXe2IF.js` 184, `index.DpLw24bj.js` 15076). After each worker run, the worker calls the provider's `takeCoverage` and sends `onAfterSuiteRun({ coverage, testFiles, environment, projectName })` to the main process. With the fixture's default isolation, every batch held one test file, in both providers, over two runs of one instance (6 batches for 3 files). `groupSpecs` (11866) puts several files in one batch only when `isolate: false` and one worker. In that case module-level code runs once per worker, so its coverage goes to the first file that loads it (inferred from the same source).
- **No `coverage` section in the config**: Squeal's options plus `coverage: { enabled, provider, reporter: [], reportsDirectory: <outside the worktree> }` collected with both providers. Nothing was written into the root, and all verdicts matched coverage off (verified by experiment).
- **The config has `coverage: { enabled: true, include, thresholds }`**, with thresholds that fail. Module states were unchanged (all `passed`). But each run set the daemon's `process.exitCode = 1` and wrote `ERROR: Coverage for lines (63.63%) does not meet global threshold (99%)` to its stderr (verified by experiment). `thresholds.autoUpdate` rewrites the config file only when `allTestsRun` is true (source, 15142). Squeal calls `runTestSpecifications(specs)`, whose default is `false` (`src/runners/vitest/run.ts` 80; source 21079).
- **Today's Squeal, incidental** (verified by experiment with the adapter's own options and no `coverage` key, `run-modes.sh project`). A project whose config enables coverage gets coverage from Squeal's warm instance now. `standalone()` calls the provider's `clean` (21034), which deleted a `coverage/` folder the developer had. Each run then wrote HTML, clover and JSON reports for that tier's files only into the worktree's `coverage/`, and printed a coverage table to the daemon's stdout. This is outside 015's scope and is a 013 matter. The fix is cheap: pass `coverage: { enabled: false }` unless 015 turns coverage on.
- **The provider package**: `provider: "v8"` without `@vitest/coverage-v8` installed stops `standalone()` with `Cannot find package '@vitest/coverage-v8'` (verified by experiment). A provider of Squeal's own (`own-provider.mjs`, 60 lines: the worker side copied from `@vitest/coverage-v8`'s `node:inspector` calls, and a main side that keeps each batch and writes no report) collected the same per-file records with no coverage package (verified by experiment).

### Q2. Mapping v8 ranges to TypeScript

Raw v8 records give, per script, functions with V8's `functionName` (`arrow`; `increment` with no class name), block ranges as offsets into Vite's transformed code, and counts. The provider's `convertCoverage(raw, project, environment)` takes the transform result and its source map from the instance and returns istanbul `FileCoverage`. That holds `fnMap` (name, `decl` and `loc` line and column) with hits `f`, `branchMap` (type `if`, `cond-expr`, ...; one location per arm) with hits per arm `b`, and `statementMap` with `s`. It names an anonymous arrow `(anonymous_2)` by order in the file (verified by experiment). The environment argument is required: without it the provider parsed raw TypeScript and dropped the file (verified). Over the same fixture at two roots, the raw records differed: the module wrapper's range ends at 2277 against 2305, because the transformed script's length carries the root through its inline source map. The mapped records, with relative paths and sorted keys, were identical for 3 of 3 test files (verified, `compare-raw.cjs`, `compare-mapped.cjs`). So only a mapped, path-relative form can be shared.

### Q3. node:test and pytest

- **node:test** (verified by experiment, Node 24.21.0, `node-test-fixture/`). With one process per file, as 003 D5 runs it, `NODE_V8_COVERAGE=<dir>` gave one file per process. Its ranges indexed the `.ts` source directly: type stripping keeps offsets, so `add` started at `function add(a: numb`. `--experimental-test-coverage` added a `test:coverage` event to the reporter stream, with per-file `functions` (name, line, count), `branches` and `lines`. Limits: the variable is in the test's `process.env`, and children inherit it and write records too. For a project that transpiles through a loader, offsets would need that loader's source maps (inferred).
- **pytest** (verified by experiment, coverage.py 7.17.0, `pytest-fixture/`). A `-p` plugin that starts `coverage.Coverage` and calls `switch_context(<test file>)` before each item attributed `add`'s body to `test_add.py` and `clamp`'s lines to `test_clamp.py`. Lines that run at import (`def`, module constants) ran once per process, in whatever context was active: none, or the test file collected last when contexts are switched at collection. 007 D6 batches five files per process, so per-file import coverage is not exact there. coverage.py must be in the project's environment, since Squeal adds no package. 007 D6 passes `--no-cov` when pytest-cov is installed. The cost of either was not measured.

### Q4. Cost

The sample is 30 of this repository's test files (`sample.txt`, every 12th of 355 under `test/{capacity,delivery,fs,hash,keys,policy,revision,scheduler,state,status,store}`). It ran in one fresh process per run with a warm instance's options, `maxWorkers: 4`, and off, v8 and istanbul alternated for 5 rounds (`bench.txt`). CPU is `/usr/bin/time` user plus system over all processes. The v8 figure includes mapping every batch after the run.

| | off | v8 (stock provider) | istanbul |
|---|---|---|---|
| one-minute load at start | 28.7 to 54.4 | 39.5 to 56.7 | 31.8 to 61.6 |
| run wall, median | 58.1 s | 55.9 s (x1.01; pairs 0.83 to 1.17) | 73.8 s (x1.28; 1.10 to 1.56) |
| CPU, all processes, median | 262 s | 283 s (x1.08; 1.02 to 1.11) | 303 s (x1.14; 1.11 to 1.23) |
| main process CPU in the run | 4.7 s | 7.0 s | 29.4 s |
| main process RSS at end | 323 MB | 742 MB | 881 MB |
| per-file mapping, main thread | | 11.0 s for 30 files | |

Verdicts were the same in all 15 runs: 29 passed, and `test/keys/validity/lock.test.ts` failed in every mode in the scratch copy. Under this load the wall-time spread between pairs (±17%) is larger than v8's effect, so v8's wall cost is "not distinguishable from 0 at n=5". Its CPU cost is +8%, about 11 s of which is the per-file mapping. The stock provider also merges and maps the whole run once at its end (part of the +2.3 s of main CPU). A provider of Squeal's own would skip that merge; its cost was not measured separately.

Bytes per test file (v8 round 0): raw 436 KiB on average (median 477), 404 MiB for 950 files. Mapped istanbul JSON is 2.6 MiB on average, 2.4 GiB for 950. A test file here loads 205 sources on average, and istanbul repeats every statement's location for each one. A compact record holds, per source, its file hash (20 bytes), a bitset of covered lines and a hit bit per function. That is 9.0 KiB per test file, 8.3 MiB for 950 (computed from `lines.mjs` records, `selection.mjs`).

### Q5. Fidelity

- v8: a test saw no `__coverage__` or `__VITEST_COVERAGE__`, an unchanged `add.toString()` (37 characters), no `NODE_V8_COVERAGE` and no `inspector.url()` (verified, `detect.test.ts`). V8 precise coverage is one state per isolate, so a test can still tell coverage is on through `node:inspector`. `self-coverage.test.ts` calls `clamp`, starts its own precise coverage, calls `clamp` once and expects a count of 1. It **passed with coverage off and with istanbul, and failed with v8 and with the own provider (count 2)** (verified by experiment). A test that stops precise coverage itself, as `detect.test.ts` does, keeps its verdict, but its file's record loses everything before the stop (only `add` remained).
- istanbul is visible: `globalThis.__VITEST_COVERAGE__` is set and `add.toString()` grew from 37 to 92 characters with counters (verified). A test that snapshots a function's source would change verdict (inferred, not run). No verdict changed in the fixture or in the 30-file sample.
- Timing: istanbul slows runs by 10 to 56%. In this repository, 92 test files compare an elapsed time against a bound (`toBeLessThan` beside `performance.now`, `Date.now() -` or `hrtime`, grep). They are the files at risk under a slower run (inferred).
- `coverage.autoAttachSubprocess` puts `NODE_V8_COVERAGE` into the worker's env (source, `@vitest/coverage-v8` `startCoverage`), so a test sees it and its children write records. This repository's `test/keys/validity/coverage.ts` reads `NODE_V8_COVERAGE` reports of the children it spawns.

### Q6. Sharing, assembly, and the code as a check

- **Keyed like a result** (inferred from C3, plus the experiments above). What a test file executes depends on the bytes of the modules it loads (its transform-graph closure), its observed runtime inputs, and the environment. These are the inputs of its check key. Every source with a record lies in the closure, because Vitest loaded it through the graph C3 reads. Coverage adds to what the key must hold: the provider and its code version, and the `include`/`exclude` options that filter mapping. Then a record is current exactly when the result at that key is current. It is stored and adopted on the same path (C4 step 3, 011-23), and pruned with its result (C7). Two runs gave identical line sets and function hit states for all 30 files (`noise.mjs`).
- **Assembly**. Coverage of source S at file hash h is the union of the records of the test files in S's reverse index (C3) whose record holds S at hash h. Such a record from a stale test file still describes the same bytes of S, but not the current version of the other files that test loads. Four states follow: covered by a current test; covered only by stale tests; not covered while every loader is current; unknown while any loader is unknown or pending. In this sample a source was loaded by a median of 22 of 30 test files (p90 25), so after an edit to S, S's coverage stays incomplete until most of the suite has run at the new keys.
- **The human's reading: functions as checks with their own state.** It holds on cost: about +8% CPU, and 9 KiB per test file. It holds on noise: 0 flips in 75,628 function states over two runs. It holds on sharing: the same keys and the same adoption. It does not hold on three points:
  1. Completeness: a function's state is final only when every test file loading its source is current. That is most of this suite for a core source, so a function changed by an edit is pending for the whole backlog. Under `lookup-only` it can stay pending until `run --all`.
  2. Identity across edits: istanbul names anonymous functions by order, V8 drops class names, and every line above a function moves its location. A per-function identity needs a name path and a text hash, not a line. That belongs to 015-02.
  3. Reach: in-process coverage misses code a test reaches only through a child process (this repository's CLI and daemon tests spawn `node`). Such a function reads "no test runs this" when tests do run it. Collecting from children is test-visible (Q5).

### Q7. Selection

`lines.mjs` recorded the covered lines of the 30 sample files at HEAD. `selection.mjs` took the last 40 commits that touch `src/` and kept each changed source still unchanged at HEAD: 76 (commit, source) edits. For each edit it counted the sample files that load the source (file level: a lower bound on the static closure) and those that ran a changed line, or a line beside a pure deletion (line level). Result: 899 runs at file level, 259 at line level, 71% fewer. 22 edits touched sources that no sample file loads. Line level is not sound: an edit to a line no test ran can still change behaviour through reflection, through data a module reads, or through declarations hoisted on load.

## Recommendation for Squeal

1. **Feasible for Vitest at about +8% CPU per run with coverage on (measured with the stock v8 provider), through a provider of Squeal's own** (Q1, Q4): `provider: "custom"` over `node:inspector`, no report written, no per-run merge. The project needs no package, and the payloads arrive per test file. Do not use istanbul: +28% wall time, 6 times the main-thread CPU, and visible to tests (Q4, Q5).
2. **Store a compact, mapped, path-relative record per test-file key** (Q2, Q4): per source, its file hash, covered lines and function hits. That is 9 KiB, against 436 KiB raw and 2.6 MiB as istanbul. Key it like the result plus the provider and its options. It then adopts and prunes with the result (Q6). Mapping costs 0.37 s of main-thread CPU per test file, so it belongs off the scheduler's path.
3. **Fidelity is the cost that decides**: v8 coverage is observable through `node:inspector` and turned a PASS into a FAIL (Q5). C10 makes that a defect, not a cost. The spec has to name a rule for such files, for example no coverage for a test file whose closure loads `node:inspector`, and name coverage in the delivery.
4. **Separately, now**: a project whose own config enables coverage already gets its `coverage/` deleted and rewritten by Squeal's warm instance (Q1). This needs a 013 row, independent of 015.
5. **The code as a check type** is feasible on cost, noise and keying. Function states need a "pending until every loader is current" rule, an identity that survives line moves (015-02), and a statement that child processes are not covered (Q6).
6. node:test can follow cheaply through `NODE_V8_COVERAGE` per process. pytest needs coverage.py in the project, and import-time lines are inexact across a batch (Q3). Line-level selection (Q7) cut runs by 71% in the sample. It is a separate feature against an 011 non-goal.

## Open questions

1. How much of this repository's `src/` do tests reach only through child processes? Not measured. It decides how many functions would falsely read as untested (Q6, point 3).
2. Noise on a wider sample, timing-dependent tests included, and over more than two runs. Here: 30 files, 2 runs, 0 flips.
3. The cost of the own provider alone, without the stock merge, against off. Expected at or below v8's +8%; not measured.
4. `isolate: false` projects attribute module-level code to one file per worker (Q1). Exclude them, or accept that?
5. Is the line-level count of Q7 worth a full-suite measurement, given 011's non-goal?
6. The rule for tests that observe coverage (Q5) is a product decision: skip coverage for them, or name it and accept the risk.

## Sources

- Vitest 5.0.3, installed under `/tmp/sq015-cov/node_modules/vitest/dist/chunks/`: `index.DpLw24bj.js` (`BaseCoverageProvider.onAfterSuiteRun` line 15076, `reportThresholdViolations` 15228 to 15250, `thresholds.autoUpdate` 15142, `runFiles` 21107 to 21148, `reportCoverage` 21459, `standalone` 21034, `enableCoverage`/`disableCoverage` 20741 to 20754, `groupSpecs` 11866 to 11920, serialized `coverage` config 9879 to 9890), `index.ggMXe2IF.js` lines 181 to 191 (worker `onAfterRunFiles` -> `takeCoverage` -> `onAfterSuiteRun`), `coverage._yXj5zeb.js` (provider resolution, `custom`), `base.DhkQeZwd.js` lines 70 and 103 (start and stop per worker run).
- `@vitest/coverage-v8` 5.0.3: `dist/index.js` (worker side over `node:inspector/promises`, `Profiler.startPreciseCoverage { callCount: true, detailed: true }`, `takePreciseCoverage`), `dist/provider.js` (`generateCoverage` 46 to 91, `remapCoverage` 153, `convertCoverage` 249, `ast-v8-to-istanbul`).
- Squeal at f6f44e03: `src/runners/vitest/adapter.ts` `#start` (the `createVitest` options, no `coverage` key), `src/runners/vitest/run.ts` line 80 (`runTestSpecifications` with the default `allTestsRun = false`), `docs/specifications/011-core/spec.md` C3, C4, C7, C10 Fidelity, C12; 003 D5; 007 D6; `test/keys/validity/coverage.ts`.
- Node 24.21.0 and coverage.py 7.17.0: run, not read; see Q3.
