# Probes for survey-020-10, child-process coverage (throwaway)

Throwaway. Nothing here is product code or a test of the product. Findings: `../../child-coverage.md`.

Versions: this repository at `1e8b506ed`, Node 24.22.1, Vitest 5.0.3, tsx 4.23.15, esbuild 0.28.2. Scratch: `.ai/cezar/t/0989b0c0/cc` (outside git; raw V8 files stay there). No daemon, no agent session, no product file changed. Host: 24 vCPUs, one-minute load 21 to 33 during the runs (named in each output).

- `fixture.mjs`: writes a small project. Sources reached only through children: `src/work.ts` (tsx child), `src/plain.mjs` (plain child, spawned with `env: { PATH }` in one test), `src/lib.ts` (an esbuild bundle with an inline map), `src/killed.mjs` (child ended by SIGKILL), `src/late.mjs` (detached child that exits 1.5 s after it starts). Two Vitest files, one node:test file. It also writes the two prototype seams:
  - `provider-children.mjs`: Squeal's `provider.mjs` wrapped. `startCoverage`, and each `takeCoverage` after it, point the worker's `NODE_V8_COVERAGE` at a new directory, and log the test file, the worker pid and the directory.
  - `children.cjs`: a node:test preload, before Squeal's `recorder.cjs`. In the test file's process it points `NODE_V8_COVERAGE` at `<Squeal's dir>/children`, so the recorder's `hideCoverage` leaves it.
- `run.sh <worktree> <scratch>` → `run.out.txt`: runs the fixture under Vitest `--pool=forks`, `--pool=threads` and `node --test`, and lists the child files at the run's end and 2 s later.
- `analyze.mts` → `analyze.out.json`: maps each child file with `ownRecord` (`src/core/code/coverage/own.ts`), joins each test file's child records to the counter with `joinCoverage`, scores CRAP, times parse plus `ownRecord` per file (`process.cpuUsage`), and maps a copy cut in half.
- `timing.sh <fixture> <raw dir>` → `timing.out.txt`: CPU of the children alone (bash `times`), variable off and on, alternated, 5 pairs of 15 × (tsx child + plain child).
- `visible.setup.ts`, `vitest.visible.config.ts`, `visible.files.txt` → `visible.out.txt`: this repository's config plus a setup file that sets `NODE_V8_COVERAGE` in each worker after it started, one directory per test file, on 18 test files that a static scan named (they compare child or process environments, or name the variable). Run: `PROBE_CHILD_RAW=<dir> node_modules/.bin/vitest run --root . --config <this dir>/vitest.visible.config.ts --maxWorkers=3 $(cat visible.files.txt)`.
- `self-count.mjs` → `self-count.out.txt`: why the one failing file fails. A process started with `NODE_V8_COVERAGE` counts calls made before its own `Profiler.startPreciseCoverage`.
