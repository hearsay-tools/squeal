# Probes for row 020-26, #189 (throwaway)

Throwaway. Nothing here is product code or a test of the product. Findings: `../../ci-coverage-both.md`.

Each script refuses to start while the one-minute load is above 24, and records the load. Each works in a `mktemp -d` directory under `/tmp` with `HOME` and `TMPDIR` inside it. Nothing in `~/projects/cezar` is written.

- `fixture/`: a tiny project. Its own coverage is V8 with `json` and `json-summary` reporters, `include: ["src/**"]` and a lines threshold of 95 that `src/untested.ts` fails (`THRESHOLD=0` turns it off). Project `iso` has three files, one of which loads a module that imports `node:inspector`. Project `shared` has `isolate: false`.
- `probe.mjs <mode> <outDir>`: one Vitest run through `createVitest`. `plain` uses the project's provider only. `squeal` is today's `ci record` (coverage off, Squeal's provider through the real `coverage.cjs`). `tee` keeps the project's provider, wraps its `onAfterSuiteRun` and lets the real `coverage.cjs` map the payloads (Vitest 5: the path, copied; Vitest 4.1: the object, written to a file). `tee-nocopy` hands Squeal the provider's own payload path and delays the provider's `generateCoverage` by 2 s. It writes `run.json` (exit code), `records.json` (Squeal's records) and `report/` (the project's report).
- `run.sh <squeal-worktree> <vitest-version>`: installs the fixture with `vitest` and `@vitest/coverage-v8` at that version and runs every mode, with the threshold, without it, and with `-t 'twice$|adds'`.
- `compare.mjs <out/version>`: the exit codes, whether each report equals the plain one, and each test file's record or why it has none.
- `timing.sh <installed dir> <squeal-worktree> <rounds>`: plain, tee and squeal alternating, wall and CPU time per run.
- `cezar-shard.sh <squeal-worktree> <rounds> <outDir> [modes]`: a `git clone --shared` of `~/projects/cezar` in `/tmp` with copied `node_modules` and `npm run build:server` (`REUSE=<dir>` skips them), then each mode on shard 1/4, 4 workers, the four unit projects, as cezarion's PR shards run: `none` (no coverage), `plain` (`COVERAGE=1`, V8 only), `tee` (`COVERAGE=1`, Squeal reads the V8 payloads). `probe.mjs` sets `reporters: []`, so cezarion's `KeepTestFilesInCoverage` reporter is in no run.

Kept outputs: `out/<version>/compare.txt`, `out/<version>/timing.txt`, `out/cezar/timing.txt`, `out/cezar/summary.txt`, `out/cezar/report-diff.txt`. The `none` line of `out/cezar/timing.txt` ran before `COVERAGE` existed, with the same command and no coverage.

To run, from this directory:

    sh run.sh <squeal-worktree> 5.0.3 && node compare.mjs out/5.0.3
    sh run.sh <squeal-worktree> 4.1.10 && node compare.mjs out/4.1.10
    sh cezar-shard.sh <squeal-worktree> 1 /tmp/r189-cezar-out "none plain tee"
