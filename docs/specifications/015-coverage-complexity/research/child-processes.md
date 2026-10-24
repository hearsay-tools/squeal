# R3: code that tests reach only through child processes

Researcher, 2026-10-24. Brief: R3 in `../tasks/wave-2.md` (spec open question 3). Probes: `probes/child-processes/` (throwaway; all runs in a scratch copy under `/tmp`; no agent session, no live daemon). Versions examined: this repository at 2e36f1ed2, Node 24.21.0, Vitest 5.0.3, `@vitest/coverage-v8` 5.0.3, tsx 4.23.15, v8-to-istanbul 9.3.0, Squeal's counter version 2.

Runs, under the full-run lock at `--maxWorkers=4`: run 1, the full suite with child coverage; run 2, the full suite with in-process coverage. The parent allowed run 2 because run 1 wrote no in-process report: 8 files failed, and `coverage.reportOnFailure` is false by default. Run 3 re-ran the 36 pytest-related test files, which runs 1 and 2 skipped because the scratch `HOME` hid uv's Pythons.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | `src/` functions that in-process coverage never runs | 377 of 7,582 (5.0%), in 120 of 649 files; 300 of them have CC 1 | experiment |
| 2a | Of those, the ones a child-process test reaches | 50 (0.66% of all functions): 31 through tests Squeal runs, 19 only through `test/e2e/**`. A lower bound (signals). 327 run in no process. | experiment |
| 2b | Known without coverage of the child? | Per test file, roughly (100% recall, 10% precision). Per function, no: the child entries' static closure holds 370 of the 377 and all 50. | experiment |
| 3 | What D9 should do | Neither `unknown` from static reach nor a project setting fits. `NODE_V8_COVERAGE` works, but costs +13% to +16% CPU on child-heavy test files, needs bundle source maps and makes 1 test fail. Keep children out; word the state as "no in-process test runs it". | experiment; source; inferred |

## Findings

### Q1. What in-process coverage never runs

- **The unit** (verified by experiment, `cc-join.out.json`). Vitest's v8 report lists 7,582 functions in 649 `src/**/*.ts` files. Squeal's counter finds the same 7,582, and each joins by body start, so the numbers are in D9's unit.
- **Never run in-process** (verified by experiment, runs 2 and 3 as a union, `analyze.out.json`): 377 functions in 120 files. By directory: `src/core/daemon` 156, `src/cli` 75, `src/core/scheduler` 52, `src/runners` 32, `src/harness` 27, `src/core/watcher` 18, others 17. Seven entry files have no function run in-process: `src/cli/index.ts`, `src/cli/ps-index.ts`, `src/core/daemon/front-desk.ts`, `src/harness/{claude-code,codex}/main.ts`, and the OpenCode and Pi plugin entries.
- **Skips matter more than children here** (verified by experiment). Run 2 alone gave 492. The difference, 115 functions, is the pytest runner. Its tests skip when uv has no managed Python (`test/helpers/pytest-env.ts` `requireSynced`; CI fails instead).

### Q2. What children reach, and what can be known without their coverage

**Measured** (verified by experiment, runs 1 and 3). A setup file set `NODE_V8_COVERAGE=<dir per test file>` inside the Vitest worker after it started (`child-env.setup.ts`). The worker then writes nothing, and every child and grandchild writes one raw file for its test file. Node propagates the variable even into a child spawned with an explicit `env` (read in source code, Node 24.21.0 `lib/child_process.js`: "process.env.NODE_V8_COVERAGE always propagates"). 7,734 raw files came from 256 test files, and 2,180 of those processes ran `src/`. tsx children were mapped through Node's `source-map-cache`. Bundled children were mapped through maps rebuilt with the shipped options; all 41 rebuilt `.mjs` files are byte-identical to the committed ones. 3,351 of 3,395 child functions that ran (98.7%) matched a report function by position.

- **63 test files** had children that ran `src/`: 47 that Squeal runs (24 in `test/harness`, 14 in `test/integration`) and 16 in `test/e2e`.
- **50 functions** ran in a child and never in-process (`child-only.out.tsv`). They are entry and process glue in 18 files: 11 in `front-desk.ts`, 9 signal and shutdown callbacks in `daemon.ts`, 4 in `pi/worker.ts`, the hook entries' `runMain`, and the `src/cli/index.ts` callbacks. 33 are anonymous. 31 have CC 1. 3 have CC 6 or more (`front-desk.ts` `receive`, `codex/main.ts` `runMain`, `pi/worker.ts` `handle`), so only those 3 would also read CRAP over 30 at coverage 0.
- **31** of them are reached by tests Squeal runs. **19** are reached only from `test/e2e/**`, which `squeal.config.json` excludes, so Squeal has no record for them in any design.
- **A lower bound** (verified by experiment, `signals.sh`). A Node process ended by SIGTERM, SIGINT or SIGKILL without a handler wrote no coverage file; with a SIGTERM handler that exits, it wrote one. The daemon handles those signals (`src/core/daemon/signals.ts`), but a child that a test kills is lost.
- **327 functions** ran in no process (`uncovered-anywhere.out.tsv`); 269 have CC 1 and 3 have CC 6 or more.

**Without coverage of the child** (verified by experiment, `static-scan.out.json`):

- *Which test files spawn Squeal code.* A scan of each test file's test-side import closure for `node:child_process` flags 626 of 1,040 files. It finds all 63 that reach `src/` (100% recall), at 10% precision: most spawn `git`, `python` or `node -e`. Adding a second signal (a `src/*.ts` path, tsx, a `dist/*.mjs` name or a bundle build) flags 284 and finds 61 of 63. The `inputs` entries in `squeal.config.json` that name `src/**/*.ts` cover 14 of the 47.
- *Which functions a child runs.* The `src/` closure of the shipped entries (every source a bundle map names) holds 611 of 649 files, 370 of the 377 never-run functions, and all 50. A static rule cannot tell the 50 from the other 320 (14% precision).

### Q3. The options for D9

- **`unknown` from static reach** (inferred from Q2): 370 of 377 never-run functions would read `unknown`. The state would fire on 7 functions and stay silent on the 320 that no test runs.
- **A project setting** (inferred from Q2): excluding the 18 files hides 89 functions that run in no process too. A list of functions has to name 33 anonymous functions, whose identity D2 calls weak.
- **Child coverage through `NODE_V8_COVERAGE`** (verified by experiment unless marked):
  - *Attribution* works per test file, as above. D8's provider could set the variable in its worker side.
  - *Fidelity.* Tests can see the variable. `test/runners/observe/recorder.test.ts` "reaches sync spawns with env {}, …" passes without it and fails with it: `expected [ +0, '1:ONLY,NODE_V8_COVERAGE:d', '' ] to deeply equal [ +0, '1:ONLY:d', '' ]`. Reproduction: `NODE_V8_COVERAGE=/tmp/x npx vitest run test/runners/observe/recorder.test.ts` gives 1 failed and 6 passed; without it, 7 passed. Node itself adds the variable to the child's `env: { ONLY: "1" }`. This is the only one of 1,040 test files, and a 011 C10 defect for any design that sets the variable.
  - *Mapping.* A bundled child maps only through a source map. Squeal's committed bundles have none, so this probe rebuilt them. The 122 unmapped scripts were test stubs under 5 KB.
  - *Late writes* (inferred). A detached daemon writes its file when it exits. That can be after the test file's result is stored.
  - *Size.* Raw output: median 0.63 MB per process and 5.3 MB per test file with children, 759 MB for the largest file, 4.3 GB for the suite. Mapping took 100 s CPU and 2 GB of memory for the suite.
  - *Timing* (verified by experiment, `timing.out.txt`). 12 child-spawning test files, off and on alternated, five pairs, no in-process coverage. CPU is user plus system of Vitest and the children it waited for, without detached daemons. All 59 tests passed in every run.

| Pair | Load (1 min) | Off: wall, CPU | On: wall, CPU | On / off CPU |
|---|---|---|---|---|
| 1 | 27 to 31 | 27.1 s, 83.8 s | 21.0 s, 84.7 s | 1.01 |
| 2 | 29 to 24 | 18.0 s, 71.4 s | 17.0 s, 70.6 s | 0.99 |
| 3 | 24 to 20 | 14.6 s, 59.4 s | 16.1 s, 68.4 s | 1.15 |
| 4 | 20 to 17 | 14.8 s, 60.9 s | 16.3 s, 68.5 s | 1.13 |
| 5 | 17 to 15 | 14.8 s, 60.7 s | 16.7 s, 70.5 s | 1.16 |

The median pair is +12.5% CPU and +10% wall. Pairs 3 to 5 (load under 25) gave +13% to +16% CPU every time. Pairs 1 and 2 ran at load 24 to 31 and showed no difference; the first "off" run also paid the cold start. Each "on" run wrote 118 MB, about 10 MB per test file. Over the whole suite the share is smaller, because 977 of 1,040 test files start no child that runs `src/`. Run 1 used 7.8% more CPU than run 2 (4,283 s against 3,972 s; both had in-process coverage, and run 1 also had child coverage). That comparison is weak: the load differed, and 8 files failed early in run 1 (inferred).

## Recommendation for Squeal

1. **Keep child processes out of D9 for wave 2**; the spec's non-goal stands. Without them, 50 of 7,582 functions (0.66%) read "no test runs it" falsely, 31 of them through tests Squeal runs, and 3 also read a false CRAP failure. Collecting them costs +13% to +16% CPU and about 10 MB of raw output per child-heavy test file. It also needs bundle source maps, makes one test fail and can lose detached daemons. The human weighs every feature by CPU per edit, and here that CPU buys back 50 functions.
2. **Never derive `unknown` from static reach**: it would hide 370 of the 377.
3. **Word the state as what it measures**: "no in-process test runs it". Then the 50 lines are true and stay evidence (D9 "Delivery"). Under D5 and D6 they surface only when an agent edits one of these functions. Over the last 300 commits that touch `src/`, 29 touched one of the 18 files (inferred, a file-level upper bound).
4. **Add skipped test files to D9's causes of `unknown`.** On a host without uv, 115 functions read "no test runs it" because their tests skipped (Q1). That is more than twice the child effect.
5. **File `recorder.test.ts` as a candidate defect**, independent of 015. It fails whenever `NODE_V8_COVERAGE` is set, for example under c8. Its child-environment check already ignores `SQUEAL*` and `NODE_OPTIONS`, and could ignore this variable too.

Limits: one repository that tests mostly in-process; one loaded host; child counts are a lower bound; the timing sample is 12 files, and 2 of the 5 pairs were too loaded to read.

## Open questions

1. How often does the dogfood edit one of the 50 functions? Only a file-level proxy is known (29 of 300 commits); a function-level count needs the counter's history.
2. What are the numbers for a project that tests mainly by spawning its CLI? Not measured.

## Sources

- Probes: `probes/child-processes/` (README, scripts, outputs). The scratch copy is `/tmp/sq015-r3`; the raw child files were deleted after conversion.
- Node 24.21.0 `lib/child_process.js` (through `process.binding("natives")`): `copyProcessEnvToEnv(env, 'NODE_V8_COVERAGE', options.env)`.
- `@vitest/coverage-v8` 5.0.3 `dist/index.js`, `dist/provider.js`: `autoAttachSubprocess` puts `NODE_V8_COVERAGE` in the worker and merges child files into the one report.
- c8 12.0.0 `lib/report.js`: `source-map-cache` and `lineLengths` handling, followed in `convert-children.cjs`.
- This repository: `src/harness/build.ts` `bundleOptions`, `src/core/daemon/signals.ts`, `test/helpers/pytest-env.ts`, `test/runners/observe/recorder.test.ts`, `squeal.config.json`, `vitest.config.ts`.
- `coverage-collection.md` Q3, Q5, Q6: children inherit the variable; the reach problem stated, not measured.
