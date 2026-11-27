# Hook and `squeal status` slowdown, 0.1.640 to 0.1.645 (row 025-26)

**Verdict: no version between 0.1.640 and 0.1.653 makes hooks or `squeal status` slower.** The slowdown in the one-run pair of 2026-11-26 is the sandbox. Its CPU ran up to about twice as slow in some windows, so the same code took about twice the CPU time. No product fix is needed. The benchmark needs a fix: repeat the runs, and measure how fast the machine was during each cell.

Examined on 2026-11-27: `squeal--v0.1.640` (`b857e6d24`), `squeal--v0.1.641` (`c4b7c21ba`), `6e79c9e3d` (0.1.644), `squeal--v0.1.645` (`4d006d600`) and `83825f040` (0.1.653). All runs used the committed plugin bundle of each ref, Node 24.22.1, boat.dev `default` sandboxes (4 vCPU, "AMD EPYC"), and Vite 8.3.8 from a local, uncommitted pin in `bench/lib.mjs`. The pin was restored before this commit.

| Question | Answer | Tag |
|---|---|---|
| 1. Bisect, then confirm | No step. Over three runs per version, 0.1.645 is the fastest version and 0.1.640 is one of the slowest. The spread inside one version (PreToolUse p95 73 to 105 ms at 0.1.640) is larger than the gaps between versions. The `wt-3` pair 0.1.640 vs 0.1.645, three runs each, shows no step either. | verified by experiment |
| 2. Cause | The machine, not the code. A hook and `status` run the same SQL statements and the same file calls in every version. Only `status` gains one statement, at 0.1.644. With identical work, one `status` call took 109 ms of CPU in one run of 0.1.644 and 188 ms in its second run, and Node's own start-up code took 1.6 to 1.9 times as long too. Across the 15 bisect cells, hook times follow the daemon's CPU per edit with r = 0.86 to 0.98. | verified by experiment |
| 3. Fix | No product fix. In the benchmark: never call a step from one run per cell; record the machine's speed per cell (CPU steal and a short fixed calibration loop beside the session); count SQL statements per hook against a real daemon. A statement count does not change with machine speed, so a test on it would catch a real increase in per-call work. | inferred, from the experiments above |

## 1. The bisect

**Verified by experiment.** One sandbox (`bx_rqsbmrha`, deleted by `boat-run.sh`) ran `bench/boat-run.sh --ref squeal--v0.1.640 --ref squeal--v0.1.641 --ref 6e79c9e3d --ref squeal--v0.1.645 --ref 83825f040 --cells ref --repeat 3`. Each version ran three times, in alternating order. Correctness passed in all 15 cells. Raw data and the scorecard: [probes/hook-slowdown/bench/bisect-ref/](probes/hook-slowdown/bench/bisect-ref/scorecard.md).

Mean of three runs, with the range (ms, CPU in s):

| Metric | 0.1.640 | 0.1.641 | 0.1.644 | 0.1.645 | 0.1.653 |
|---|---|---|---|---|---|
| PreToolUse p95 | 91 (73–105) | 84 (74–98) | 81 (68–102) | 67 (62–77) | 85 (73–107) |
| PostToolBatch p95 | 116 (98–138) | 102 (95–115) | 111 (79–156) | 83 (75–94) | 114 (91–154) |
| SessionStart, slowest | 101 (90–118) | 138 (133–143) | 131 (104–179) | 81 (74–87) | 123 (117–131) |
| `squeal status` p95 | 152 (120–196) | 168 (143–186) | 157 (125–217) | 114 (105–124) | 148 (120–195) |
| CPU per edit | 1.1 (0.9–1.4) | 1.1 (1.0–1.2) | 1.2 (0.9–1.6) | 0.9 (0.8–1.0) | 1.1 (0.9–1.4) |

No metric moves at a version and stays moved. 0.1.645, the version the brief reported as slow, has the lowest mean on each line. Each version's range overlaps the others.

The slow cells are slow in every number at once, whatever the version ([bisect-ref-cells.tsv](probes/hook-slowdown/results/bisect-ref-cells.tsv), in run order). Examples: 0.1.653 run 2 (PreToolUse p50 66 ms, `status` p95 195 ms, CPU per edit 1.33 s), 0.1.644 run 2 (67, 217, 1.52) and 0.1.640 run 3 (62, 196, 1.34). Against the same versions' fast runs: 0.1.653 run 1 (48, 120, 0.87), 0.1.644 run 1 (45, 125, 0.84), 0.1.640 run 2 (44, 120, 0.85). Over the 15 cells, the Pearson correlation with the daemon's CPU per edit is 0.94 for PreToolUse min, 0.98 for its p50, 0.86 for its p95, 0.96 and 0.95 for PostToolBatch p50 and p95, and 0.93 for `status` p95 ([cell-stats.mjs](probes/hook-slowdown/cell-stats.mjs)). A hook does not use the daemon's CPU, so hook time and daemon CPU both follow a third thing: how fast the CPU runs during that cell.

The brief's pair fits this. In `bench/results/2026-11-26-0.1.640-vs-0.1.645-default-AMD-EPYC/`, the 0.1.645 `ref` cell also had the slower plain Vitest run (33.0 s against 29.8 s). Plain Vitest runs before Squeal starts and runs no Squeal code. The daemon's CPU per edit was 1.10 s against 0.75 s. The two 0.1.640 vs 0.1.641 runs of 2026-11-26 point in opposite directions (PreToolUse p95 +33% on one sandbox, −6% on the other), which is what noise looks like.

## wt-3

**Verified by experiment.** `bench/boat-run.sh --ref squeal--v0.1.640 --ref squeal--v0.1.645 --cells wt-3 --repeat 3`, in one sandbox (`bx_k8ee33s5`). Raw data: [probes/hook-slowdown/bench/wt3/](probes/hook-slowdown/bench/wt3/scorecard.md).

Three runs per version, alternating order; correctness passed in all six cells. This sandbox had a slower CPU (SHA-256 1959 MiB/s, against 2532 on 2026-11-26), so its absolute numbers do not compare with the brief's run. Per run, in the order r1, r2, r3:

| Metric | 0.1.640 | 0.1.645 |
|---|---|---|
| PreToolUse p95 (ms) | 157, 133, 116 | 135, 141, 111 |
| PostToolBatch p95 (ms) | 254, 244, 190 | 173, 222, 167 |
| Hook write wait, longest (ms) | 194, 59, 9 | 24, 17, 34 |
| Hook writes waiting over 250 ms | 0, 0, 0 | 0, 0, 0 |
| `squeal status` p95 (ms) | 304, 252, 231 | 241, 252, 222 |
| Lock holds over 250 ms | 9, 5, 6 | 7, 8, 4 |
| CPU per edit (s) | 0.7, 0.5, 0.4 | 0.4, 0.6, 0.4 |

0.1.645 is not worse on any line; its means are lower or equal. The brief's single `wt-3@0.1.645` cell (PreToolUse p95 325 ms, write wait 1476 ms, 13 lock holds, 2 long write waits) is outside the range of all six cells here. Lock holds over 250 ms happen in both versions, 4 to 9 per cell, so they are a property of three worktrees on this sandbox. They are not a 0.1.645 change.

## 2. Cause, with a real daemon

**Verified by experiment.** [profile.mjs](probes/hook-slowdown/profile.mjs) ran each of the five versions twice, in alternating order, in one sandbox (`bx_bhmawfs4`, deleted). Each run has a real daemon on a copy of the benchmark's p500 project, after `squeal run --all --wait`. The probe measures four things:

- Hooks and `squeal status`, 40 rounds each, with no test running.
- The SQL statements and sync file calls of single calls, using [instrument.mjs](probes/hook-slowdown/instrument.mjs).
- CPU profiles of single calls (`--cpu-prof`).
- A 12-step `bench/session.mjs` session, three more times with the CPU profiled through the inspector: once for the daemon's main thread, once for its runner host and once for its store process.

All ten runs exited 0. Reduced data: [profile-summary.json](probes/hook-slowdown/results/profile-summary.json); per-run `result.json` and session logs are under [results/](probes/hook-slowdown/results/).

**Work per call does not change.** Each pair is SQL statements / sync file calls, three samples per version, all equal:

| Call | 0.1.640 | 0.1.641 | 0.1.644 | 0.1.645 | 0.1.653 |
|---|---|---|---|---|---|
| PreToolUse (Edit) | 61 / 14 | 61 / 14 | 61 / 14 | 61 / 14 | 61 / 14 |
| PostToolBatch (Read) | 117 / 16 | 117 / 16 | 117 / 16 | 117 / 16 | 117 / 16 |
| `squeal status`, plain and `--json` | 68 / 22 | 68 / 22 | 69 / 22 | 69 / 22 | 69 / 22 |

**Read in source code.** The one extra `status` statement is the `meta` read of `containersOf` (`src/core/status/container-status.ts`, `3d8b16b60`, 0.1.644). Store, delivery and scheduler code is the same in 0.1.640 and 0.1.645 (`git diff --stat squeal--v0.1.640 squeal--v0.1.645 -- src/core/store src/core/delivery src/core/scheduler` is empty). In the hook path, only `src/harness/shared/context.ts` changed (the hook context carries no status builder, 0.1.641) and `stop-states.ts` changed (Stop only). The hook bundles are 90 KB smaller from 0.1.641. The CLI bundle grows from 5.31 MB to 5.44 MB at 0.1.644 (Jest and containers), and `status` loads it. The quiet `status` minimum shows no step at 0.1.644: 83 and 89 ms at 0.1.640, 89 and 109 ms at 0.1.644, 95 ms twice at 0.1.645.

**The same work takes different CPU time.** Quiet timings, with no test running, vary between two runs of one version as much as between versions: PreToolUse p50 39.8 and 61.8 ms at 0.1.644, `status` p50 102.9 and 156.9 ms. The CPU profile of one `status` call shows where the extra time goes:

| Run | CPU of the call | Squeal's bundle | Node ESM loader | Node bootstrap | GC |
|---|---:|---:|---:|---:|---:|
| 0.1.644 run 1 | 109 ms | 42.2 | 14.2 | 7.5 | 8.4 |
| 0.1.644 run 2 | 188 ms | 64.8 | 21.2 | 14.0 | 25.2 |
| 0.1.653 run 1 | 118 ms | 45.2 | 14.0 | 8.7 | 9.8 |
| 0.1.653 run 2 | 220 ms | 80.2 | 25.6 | 13.8 | 26.6 |

Node's own bootstrap code costs 1.6 to 1.9 times as much in the slow run, as does Squeal's code. The SQL and file counts are identical, so the code did the same work. That points to the CPU, not to Squeal. **Inferred:** the cause is other tenants on the shared host (the sandboxes report `machineProvider: baremetal` and 4 of a larger EPYC's threads). The probe sandbox's `/proc/stat` showed 1.0% steal since boot (2 hours, nearly all of it the probe). Cache and memory-bandwidth sharing does not show up as steal, so the exact mechanism is not determined.

The daemon's main thread used 3.0 to 10.0 s of CPU across the profiled sessions, in no version order (0.1.645: 5.3 and 3.0 s; 0.1.644: 4.4 and 10.0 s). Its largest items in every version are garbage collection, `spawn`, and SQLite `run`/`all`/`get`. The runner host is dominated by `spawn`; the store process is under 0.6 s. No new function appears among the top functions at any version.

## 3. Fix and how to verify it

**No product change.** Nothing in the range adds per-call work beyond the one `status` meta read, which is 1 of 69 statements.

**Benchmark changes (inferred from the experiments; for the coordinator to decide):**

1. Do not name a step from one run per cell. Compare a step only when its change exceeds the spread of `--repeat 3` runs. On this sandbox type, three runs of one version spread PreToolUse p95 over 73–105 ms and `status` p95 over 125–217 ms.
2. Record the machine's speed in every cell: the `/proc/stat` steal share during the session, and a fixed CPU loop (the existing SHA-256 calibration) run before and after each session, not only at the start. The scorecard can then flag a cell that ran on a slow machine, or scale its numbers.
3. Put hook p50 beside p95 when two versions are compared. p50 followed the machine as closely as p95 did (r = 0.98), so a gap in p50 that stays across repeats is the better sign of a real change.

**A test for real per-call work.** A test that runs each hook and `squeal status` against a real daemon on a fixture with results, and counts the executed SQL statements and sync file calls (as [instrument.mjs](probes/hook-slowdown/instrument.mjs) does), would catch a real increase in work, and machine speed cannot change its result. This probe found the counts stable across five versions, so a budget of today's counts plus a margin would be a quiet test. It would not catch slower statements (a missing index), so it complements the benchmark and cannot replace it.

## Open questions

- What makes the sandbox CPU slow in some windows: steal, shared cache, or frequency. Not determined, because the benchmark records none of these per cell.
- Whether 0.1.645's lowest means in the bisect are real. Its CPU per edit was also the lowest in each round, which fits a fast machine during its cells. The counts show no less work.

## Sources

- Benchmark: `bench/README.md`, `bench/boat-run.sh`, `bench/session.mjs`, `bench/lib.mjs` at `83825f040`; results `bench/results/2026-11-26-0.1.640-vs-0.1.645-default-AMD-EPYC/`, `bench/results/2026-11-26-0.1.640-vs-0.1.641-default-AMD-EPYC*/`.
- Prior probe: `research/hook-runtime.md`, `research/probes/hook-latency/runtime/`.
- Source: `git diff squeal--v0.1.640 squeal--v0.1.641 -- src`, `git diff squeal--v0.1.641 6e79c9e3d -- src`, commits `3d8b16b60`, `086d328b5`, `208aeee43`, `3522e5cfb`.
- Probes: `research/probes/hook-slowdown/` (README lists how to run them).
