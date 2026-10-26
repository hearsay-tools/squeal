# 015-76: coverage under node:test

Researcher, 2026-10-26. Brief: R1 in `../tasks/wave-16.md`. Probes: `probes/node-test-coverage/` (throwaway; `HOME=/tmp/r-015-76/home`, all output under `/tmp/r-015-76/`, no daemon, no agent session, no `evals/bin` script). Versions examined: Node 24.21.0 and 22.23.3, tsx 4.23.15 (esbuild 0.28.2), Node's source at tag v24.21.0 (`lib/child_process.js`, `lib/internal/process/pre_execution.js`, `lib/internal/test_runner/coverage.js`), this repository at b062c9832. Every probe runs a file with Squeal's own command line (`src/runners/node-test/run/run.ts`): `--enable-source-maps`, the recorder as first `--require`, the project's argv, `--test`, Squeal's reporter.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | `NODE_V8_COVERAGE` or the `test:coverage` event | `NODE_V8_COVERAGE`. Its files are V8's precise coverage, the shape Squeal's `mapScript` already takes, with the loader's source map inside. The event cannot give D8's record: it has no function ends, lists every line (blank and comment lines too) instead of lines with code, marks lines that did not run as run under tsx, and merges every process. | experiment; source |
| 2 | Offsets under a loader (tsx) | Wrong without source maps: they index tsx's output (3 lines for a 50-line file), and reading them against the `.ts` file inverts verdicts. The source map is in each file (`source-map-cache`, because Squeal passes `--enable-source-maps`). Mapped through it, 7 of 8 fixture functions are right and 1 is `unknown`. The line rule needs one change, since the executed code is not in the file. Without a loader (type stripping), offsets index the `.ts` file, as 015-01 found. | experiment |
| 3 | Child processes | Node copies the variable into every child, even into a child spawned with an explicit `env`. Deleting it from `process.env` in the test file's own process keeps that process's file and stops every child file, on Node 22 and 24, and the test then sees no variable. The `node --test` parent writes no file. | experiment; source |
| 4 | Cost per test file | **Pending.** No measured run has started: the one-minute load has been over 24 since 18:01Z (readings below). | not measured yet |

## Findings

### Q1. Which source maps to D8's record with less work

- **`NODE_V8_COVERAGE`** (verified by experiment, `out/map-shapes-node24.txt`, `out/map-shapes-node22.txt`). Each process writes `coverage-<pid>-<time>-<n>.json`: `result` (per script: `url`, `functions` with `functionName`, `ranges` of offsets and counts, `isBlockCoverage`) and `source-map-cache` (per script a loader mapped: `lineLengths` of the executed code and the map `data`, with `sourcesContent`). `result` is the type Squeal already declares as `V8Script` (`src/core/code/coverage/types.ts`), so `mapScript` and `joinCoverage` run on it unchanged (`map.ts` imports both). The work Squeal adds: set the variable per file run, read the files of the test file's own process, keep the scripts inside the worktree and outside `node_modules`, and build each script's `ExecutedSource` from the payload (the map, and blank lines of `lineLengths` as the code) or, without a map, from the file on disk. Blob confirmation can use `sourcesContent`, as `buildRecord` already does for Vite (the tsx map's `sourcesContent` held all 1,153 characters of `shapes.ts`). A smoke run of the Q4 sample (34 files, not measured, see Q4) wrote 41.8 MB, 1.2 MiB per test file; most of it is Node's own `node:` scripts, which a file holds about 180 to 225 of.
- **The `test:coverage` event** (verified by experiment, `out/map-shapes-node24.txt` EVENT lines, `out/event-plain.txt`; read in source code, `coverage.js` 218-345 and 430-520). With `--experimental-test-coverage`, the `node --test` parent points the variable at its own temporary directory (`setupCoverage`, 634-654), merges every file in it by URL (`mergeCoverage`, 532-549), and emits per source file `functions` (`name`, `line`, `count`), `branches` (`line`, `count`) and `lines` (`line`, `count`). Squeal's reporter already writes the event into `events-<i>.ndjson`. It does not give D8's record:
  - Functions have a start line and no end, so D9's join by end position cannot run; it adds entries such as `<instance_members_initializer>@29`.
  - `lines` lists every line of the file but those its ignore comments and type-only lines remove, with blank and comment lines counted as run (`CoverageLine` starts an empty line at count 1). D8's "lines with code" bitset cannot be read from it.
  - Under tsx, lines that did not run read as run: `plain.ts` line 7 (`return value;`, not reached by `clamp(9, …)`) has count 1 with tsx and 0 under type stripping; `shapes.ts` lines 16 and 23–24 also read as run. The source maps lead it there (`mapCoverageWithSourceMap` sets whole line spans per range).
  - It merges the child processes' files with the test file's own (Q3): `child-only.ts`, which only the spawned child loads, is listed with `childOnly@2:1`.
  - Node 22.23.3 lists the test files in it; 24.21.0 leaves them out by default.
- **Verdict.** `NODE_V8_COVERAGE` costs Squeal a read and parse per file and a map step, which its Vitest path already has. The event saves that parse but gives data that cannot fill D8's record and is wrong under a loader.

### Q2. TypeScript through a loader

- **Offsets index the loader's output** (verified by experiment, Node 24 and 22, `out/map-shapes-node24.txt`). tsx handed V8 a 3-line module for the 50-line `shapes.ts` (`lineLengths` `[871, 0, 2758]`: the code, a blank line, the inline map). Read as offsets into the `.ts` file (variant A), the join inverted verdicts: `Ledger.constructor` and `Ledger.describe` read "not run", `Ledger.neverCalled` read "ran", and in the child's `plain.ts`, `clamp` read "not run" and `unused` "ran".
- **The map is in the file** (verified by experiment). Every tsx-loaded script had a `source-map-cache` entry, because Squeal runs `--enable-source-maps`. Mapped through it (variant B), every function's ran/not-run matched the test: `area`, `convert`, the constructor, `add`, `describe` and `largest` ran; `neverCalled` did not. One function, the `reduce` callback on `largest`'s line, reads `unknown`: the map's last segment before the arrow's end is at column 98 and the counter's end is at 103, outside the join's 2-column slack. That is one of 8 functions in a single fixture; the rate at scale is pending (`join-rate.ts`, Q4's runs).
- **The line rule needs the source** (verified by experiment). The payload has the executed code's line lengths, not its text. `mapScript`'s closing-punctuation rule reads the executed text, so over blank lines it counts `}` lines as code (B: `area` 3/4, `convert` 6/8). Read at the mapped position in the source instead (variant D, 25 lines in `map.ts`), the lines match the test and match type stripping: `area` 2/3 (line 16 not run), `convert` 4/6 (the `Unit.Foot` case not run), `clamp` 3/4 and `unused` 0/2, the same as `plain.ts` under type stripping (`out/map-plain-strip-node24.txt`). A load hook registered after tsx with `module.register` saw the untransformed `.ts` text, not tsx's output (verified by experiment; the hook was removed from the probes), so the executed code cannot be captured that way.
- **Without a loader**, Node 24.21.0 and 22.23.3 strip types in place: no `source-map-cache` entry, offsets index the `.ts` file, and variant A is right (verified by experiment, `out/map-plain-strip-node2*.txt`).

### Q3. Child processes

- **Propagation** (read in source code, `child_process.js` 704-706 and 533-539): `copyProcessEnvToEnv(env, 'NODE_V8_COVERAGE', options.env)` copies `process.env.NODE_V8_COVERAGE` into the child unless `options.env` has its own key. Verified by experiment: `shapes.test.ts` spawns `node --import tsx src/child-main.ts` with `env: { PATH }`, and that child wrote 2 files with `child-main.ts`, `child-only.ts` and `plain.ts` in them (`out/children.txt`).
- **Deleting the variable in the test process** (verified by experiment, Node 24.21.0 and 22.23.3, `drop-env.cjs`, `out/children.txt`). Node reads the directory at startup (`pre_execution.js` 425-437, `setupCoverageHooks`). A `--require` that deletes `process.env.NODE_V8_COVERAGE` where the runner set `NODE_TEST_CONTEXT` (the test file's own process, not the parent) left exactly one file, the test process's, mapped to the same verdicts as before. The child wrote none, and `env.test.ts` printed `NODE_V8_COVERAGE=<unset>` instead of the directory, so a test cannot see coverage through the variable. Without the delete, the test process wrote 3 files: the main thread's and two that held only Node's own scripts, the recorder, one tsx script and the removed capture hook (threads of that process). With the delete, it wrote 1. So threads started after the delete write nothing (inferred). A child that sets its own `NODE_V8_COVERAGE` writes to its own directory (inferred from the same source line).
- **The `node --test` parent wrote no file** in any run on either Node (verified by experiment; the cause was not read).
- **Telling processes apart** without the delete is by the pid in the file name. Squeal's recorder already writes one `graph-<pid>.ndjson` per process, but the probe's guess at the test file's pid from those files (an unmarked edge with no parent) picked the parent when a `--require` is an absolute path, since the recorder then ends its preload marking early. A pid rule would need the recorder to write the test process's pid (inferred).
- **Counting children** is possible by pid (each child's file maps the same way: `childOnly` ran 2/2), but D9's `uncovered` measures "in its own process" and `child-processes.md` chose to keep children out. The delete keeps them out at no cost.

### Q4. Cost

Pending. The probe (`bench.mjs`, `bench-loop.sh`) runs 34 files (30 of `gen-big.mjs`'s test files, `reference/packages/demo`'s 3, `spawn-cli`'s 1) at 4 processes at once in modes `off`, `raw`, `drop` (raw plus the delete) and `event`, 5 rounds with the order rotated, and starts a run only while the one-minute load is at most 24. One-minute load readings so far: 17:55Z 21.6, 17:58Z 22.7, 18:01Z 29.2, 18:02Z 42.0, 18:03Z 52.2, 18:04Z 34.8, 18:05Z 31.3, 18:06Z 35.6. No measured run has started.

One unmeasured smoke run of mode `drop` started at 18:01Z at load 29.2, before the loop, to check that the sample runs: 34 of 34 files passed, 12.1 s wall, 41.8 MB of coverage files. Its timings are not a cost figure. Single-file runs in Q1–Q3 are not a cost figure either.

## Recommendation for Squeal

Take node:test coverage from `NODE_V8_COVERAGE`, never from the `test:coverage` event:

1. Per file run, set `NODE_V8_COVERAGE=<logDir>/cov-<i>` in the environment of the `node --test` process.
2. In the test file's own process, delete the variable from `process.env` at startup. The recorder runs there first already and knows that process (it sets `SQUEAL_NODE_TEST_STARTED`); that is a runner change in `src/runners/**`. Then every file in the directory belongs to the test file, children write none, and a test cannot read the variable.
3. Map each own script through Squeal's `mapScript`, with the payload's `source-map-cache` map over its `lineLengths` when there is one, and the file on disk when there is none. Read the closing-punctuation rule at the mapped source position when the executed text is absent. Confirm the blob from the file or the map's `sourcesContent`, as `buildRecord` does.
4. D8's other rules carry over unchanged: the record only for a whole completed file, files that import `node:inspector` run without coverage.

The decision waits on Q4: whether the parse and map cost per file (1.2 MiB of JSON per file in the smoke run) and the run's extra CPU are acceptable beside load.

## Open questions

1. Q4's cost, and the join rate at scale (`join-rate.ts`), both from the benchmark's runs.
2. Why the `node --test` parent writes no coverage file (verified on both Nodes, not read in source). If a later Node writes one, the delete still keeps children out, but the directory would also hold the parent's file.
3. Whether tsx's maps lose more function ends than the one in the fixture: the `reduce` callback read `unknown` because the map has no segment at its last token.
4. Whether Squeal should strip Node's `node:` scripts before parsing (most of each file's bytes); V8 writes them and the format has no filter.

## Sources

- Node v24.21.0 source: https://raw.githubusercontent.com/nodejs/node/v24.21.0/lib/child_process.js (533-539, 704-706), `lib/internal/process/pre_execution.js` (425-437), `lib/internal/test_runner/coverage.js` (75-140, 218-345, 404-520, 532-557, 632-660), fetched 2026-10-26 to `/tmp/r-015-76/src-node/`.
- This repository: `src/runners/node-test/run/run.ts`, `src/runners/node-test/runtime/recorder.cjs`, `src/core/code/coverage/{map,ranges,sourcemap,record,types}.ts`, `src/core/code/crap/join.ts`, `test/fixtures/node-test/` (`gen-big.mjs`, `reference/`, `spawn-cli/`).
- Prior research: `coverage-collection.md` Q3 and Q4, `child-processes.md`, spec 015 D8 and D9, spec 003 D5.
- Probes and outputs: `probes/node-test-coverage/` and its `README.md`.
