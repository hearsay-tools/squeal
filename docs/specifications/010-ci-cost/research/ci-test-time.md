# ci-test-time: why a Node job's Test step takes 20 minutes

Researcher findings for spec 010, topic `ci-test-time` (`README.md`). Examined 2026-10-15: `.github/workflows/ci.yml` and `vitest.config.ts` at 811efaed, Vitest 5.0.3 (`package-lock.json`), GitHub's record of `hearsay-tools/squeal` CI. Read-only on GitHub; no local test runs.

Data sets, named below by letter:

- **A**: the 24 Node job logs of the 12 latest green runs with distinct SHAs, 2026-10-15 09:5x to 14:47 UTC: 38750985142, 38750545790, 38749970679, 38749948742, 38749913339, 38748735530, 38748619993, 38748031233, 38747854038, 38746847515, 38746746964, 38746482076. Per-file times are Vitest's own `✓ file (n tests) Xms` lines.
- **B**: `gh run list --workflow ci.yml --limit 1500`: 1500 runs, 2026-10-09 18:18 to 2026-10-15 14:47 UTC. 1055 success, 437 failure, 1 cancelled, 7 in progress. Jobs (`filter=all`) for all 444 failed, cancelled or re-attempted runs, and the `FAIL` lines of all 769 failed Node jobs.
- **C**: job and step times of 10 green runs per day from B (120 Node jobs), and four green job logs from 2026-10-12 and 2026-10-14.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Where the 20 minutes go | 634 files, 3,323 s summed file time (median, A). Top 20 files are 44.6%; 66 files over 10 s are 68%; 320 files under 1 s are 1.8%. 3 Vitest workers (4 vCPU runner, `cpus - 1`). Longest file 245 s against 1,108 s of file time per worker: not critical-path bound | verified from logs, read in source and docs |
| 1a | Why it doubled | Green Test step p50 10.6 min on 10-10, 19.0 min on 10-15 (C). +216 files and +1,300 s summed since 10-12, mostly the pytest (007) and OpenCode and Pi (008) suites | verified from logs |
| 2 | CPU-bound or waiting | Workers are always busy (wall 1,180 s, file time / 3 = 1,120 s). About 80% of file time scales with runner speed, about 20% does not (timeouts, waits) | verified from logs, inferred cause |
| 3 | One-Node failures | 112 of 437 failed runs were red on one Node only (65 Node 22, 47 Node 24). One real Node-22-only defect (npm 10.9.9 crash, 5 runs); one Node-22-only flake class (`ENOTEMPTY` on cleanup, 22 file failures, never on 24); the rest flake on both | verified from logs |
| 4 | Options | Table under 4 | estimated from A |
| 5 | Reruns | 7 of 1500 runs had `run_attempt` 2, each a re-run of one failed Node job, 5 of 7 Node 22 | verified from GitHub's record |

## Findings

### 1. Per-file durations, worker count, critical path

Top 20 files by median time over A's 24 jobs. "Fast/slow" is the file's median on fast runners over its median on slow runners (see 2); near 1.00 means the file waits, it does not compute.

| # | File (`test/`) | s | % | Family | Fast/slow |
|---|---|---|---|---|---|
| 1 | `scheduler/backlog-tiers.test.ts` | 244 | 7.4 | - | 0.74 |
| 2 | `e2e/pytest.test.ts` | 244 | 7.3 | e2e, pytest | 0.86 |
| 3 | `e2e/opencode.test.ts` | 137 | 4.1 | e2e, fixture | 0.80 |
| 4 | `scheduler/timed-out-tier.test.ts` | 126 | 3.8 | - | 0.99 |
| 5 | `daemon/drain.test.ts` | 71 | 2.1 | - | 0.92 |
| 6 | `e2e/policy.test.ts` | 65 | 2.0 | e2e | 0.87 |
| 7 | `cli/warmup.test.ts` | 60 | 1.8 | - | 0.91 |
| 8 | `daemon/departure.test.ts` | 58 | 1.7 | - | 0.91 |
| 9 | `daemon/lifecycle.test.ts` | 55 | 1.7 | - | 0.92 |
| 10 | `scheduler/backlog.test.ts` | 52 | 1.6 | - | 0.57 |
| 11 | `daemon/busy-store.test.ts` | 43 | 1.3 | - | 0.99 |
| 12 | `runners/pytest/run/basetemp.test.ts` | 43 | 1.3 | pytest | 0.63 |
| 13 | `e2e/lifecycle.test.ts` | 42 | 1.3 | e2e | 0.80 |
| 14 | `scheduler/runner-work.test.ts` | 38 | 1.1 | - | 0.98 |
| 15 | `e2e/pi.test.ts` | 36 | 1.1 | e2e, fixture | 0.75 |
| 16 | `runners/pytest/run/run.test.ts` | 35 | 1.1 | pytest | 0.84 |
| 17 | `scheduler/discards.test.ts` | 35 | 1.0 | - | 0.97 |
| 18 | `integration/status-wait-edit.test.ts` | 34 | 1.0 | - | 0.94 |
| 19 | `harness/opencode-hooks.test.ts` | 33 | 1.0 | fixture | 0.70 |
| 20 | `e2e/slow-node-test.test.ts` | 32 | 1.0 | e2e, slow | 0.65 |

By family over all 634 files (a file can be in two): `test/e2e` 16 files, 665 s, 20.0%; pytest 41 files, 486 s, 14.6%; Pi, OpenCode or Codex fixtures 67 files, 448 s, 13.5%; slow-suite named files 45, 212 s, 6.4%. Their union is 119 files, 1,190 s, 36%. The other 64% is daemon, scheduler and watcher tests that start real daemons and nested Vitest runs: `backlog-tiers` runs a 200-file backlog through nested Vitest three times (its log line: "direct vitest run 19525 ms"), `timed-out-tier` waits out a 30 s runner timeout several times by design (`TIMEOUT_MS = 30_000`). Verified from logs; families by path, inferred.

Workers: the runner is 4 vCPU, 16 GB for public repositories (read in official docs, runners reference). Vitest 5.0.3 defaults to `max(availableParallelism - 1, 1)` outside watch mode, so 3 workers (read in source code, `getDefaultThreadsCount`, `dist/chunks/index.DpLw24bj.js`). `vitest.config.ts` sets no `maxWorkers` or pool, so the pool is `forks` with one process per file (Vitest docs). The log's own summary agrees: "634 workers spawned · ~131ms startup each".

Critical path: longest file 245 s against 3,359 s / 3 = 1,120 s per worker (slow runners). The step is throughput-bound, not bound by one file. A list-scheduling simulation of A's file times on 3 workers in random order gives a median wall of 1,165 s against the observed 1,170 to 1,231 s on slow runners, so the model below is calibrated to within about 3% (inferred from logs). Vitest orders files by its result cache, which CI does not keep, so the order is the discovery order (read in source code, `BaseSequencer.sort`).

Growth (C): green Test step p50 by day 10.6, 11.0, 11.0, 12.5, 14.2, 19.0 min (10-10 to 10-15). Green job logs on 10-12 had 418 files and 1,614 to 1,930 s summed; on 10-14 471 to 479 files, 2,033 to 2,284 s; on 10-15 634 files, 3,359 s. New between 10-14 and 10-15 logs: 155 files, 1,028 s, led by `e2e/pytest` (245 s), `e2e/opencode` (138 s), `runners/pytest/run/basetemp` (44 s) and `e2e/pi` (36 s). Verified from logs.

### 2. CPU-bound or waiting

Wall against summed file time: 1,180 s wall and 3,350 s file time on slow runners, 910 s and 2,630 s on fast ones, a ratio of 2.85 to 2.9 on 3 workers: no idle workers to speak of (verified from logs). Whether a busy worker computes or sleeps shows in runner speed. A's jobs split in two: 6 of 24 ran in 902 to 1,012 s, 18 in 1,110 to 1,231 s, independent of Node version. All 6 fast jobs ran in `westus2` or `westus3` (the log's "Region" line); 1 of the 18 slow ones did (inferred: a faster VM generation there; GitHub does not document it). Fast-runner file time is 79% of slow-runner file time. Files whose time barely moves (fast/slow above 0.92) hold 20% of slow-run file time: `timed-out-tier` (0.99), `busy-store` (0.99, a 7 s write hold), `runner-work`, `discards`, `ordering`, `revision-lag`, `stop-slow-handoff` (1.00). The rest scales with the CPU: nested Vitest, pytest, OpenCode and daemons spawned under the 3 workers on 4 vCPUs. Mostly CPU-bound, with a fifth in fixed waits (inferred from the logs).

### 3. Failures on one Node version

B, latest attempt per run: 325 failed runs red on both Nodes, 65 on Node 22 only, 47 on Node 24 only. Per file, across the 769 failed jobs (verified from logs):

- Real Node-22-only defect: `e2e/shipped-plugin.test.ts`, 5 runs on 2026-10-13 from 3dc61b4d, Node 24 green each time. "npm error Cannot read properties of null (reading 'edgesOut')": Node 22.23.3's bundled npm 10.9.9 crashes on `npm install vitest@5.0.3`; worked around in 65acfe0b. Node 24 alone would have missed it, and a user on Node 22 would hit the same npm.
- Node-22-only flake class: `ENOTEMPTY: directory not empty, rmdir '<tmp>/.git'` in a test's `rmSync(..., { recursive: true, maxRetries: 5 })` cleanup. `policy/repository-inputs` 17 jobs, `cli/setup/candidates` 3, `harness/opencode-dispose` 1; never on Node 24. The cause (a git child still writing during cleanup, and Node 22's removal implementation retrying differently from 24's) is inferred, not read.
- Node-24-only, small n: `daemon/slow-lane` 3 (empty slow key), five files once each.
- Both versions, flakes under load: `watcher/reconcile-pass` (11 one-sided, 89 both-sided; "expected 941 to be less than 500"), `watcher/parcel-links` 10 and 34, `integration/node-test-packages` 8 and 4, `daemon/escaped` 6 and 2, `runners/node-test/graph-cost`, `cli/warmup`, `e2e/lifecycle`, `e2e/stop-gap`. These are the bulk of the 112 one-sided runs: the second Node job is a second draw on a flaky test, not a second signal.

Version-dependent code a single Node would stop exercising (read in source code at 811efaed): node:test identity from `parentId` on 24 and `nesting` on 22 (`src/runners/node-test/identity.ts`); the proxy assertion for Node 24.5+ (`test/harness/opencode/bridge-client.test.ts:185`); the OpenCode host's minimum Node (`src/harness/opencode/host.ts`); the Pi minimum 22.19 (`test/helpers/pi.ts:25`); the bundled npm used by e2e fixture installs (`test/e2e/install.ts`). The files on those paths (`node-test`, `e2e/shipped-plugin`, `e2e/plugin-copy`, `e2e/pi-update`, `opencode/bridge`, `keys/environment`) are 47 files, 144 s, 4.3% of file time.

### 4. Options

Baseline per run: 2 Node jobs of 20.2 min, 40.4 job-minutes, about 20 min wall after queueing. Outside Test each job spends about 35 s (setup, npm ci, uv and two Pythons, lint, typecheck, build: run 38749970679). Shard walls come from the simulation in 1, with Vitest's own split (files sorted by sha1 of path, cut into equal counts, read in source code, `BaseSequencer.shard`); they assume per-file times do not change on a shard.

| Option | Wall (Test) | Job-min per run | Jobs | Loses |
|---|---|---|---|---|
| Today | 19.4 min | 40.4 | 2 | - |
| Full suite on one Node, the 47 version-sensitive files on the other | 19.4 min | about 22 | 2 | Node-22-only flakes outside the subset (the `ENOTEMPTY` class) if Node 24 is the full one; any unknown version difference outside the subset |
| Full suite on one Node only | 19.4 min | 20.2 | 1 | The npm 10.9.9 class of defect if Node 24 is kept; node:test `parentId` path if Node 22 is kept |
| `--shard` 2 per Node | 11 min | about 42 | 4 | Nothing; doubles concurrent jobs, needs a merge step (`--reporter=blob`, `--merge-reports`) |
| `--shard` 3 per Node | 7.2 min | about 45 | 6 | Nothing; triples concurrent jobs. Vitest's count split leaves shards uneven (1,006 to 1,223 s) |
| `--shard` 4 per Node | 6.4 min | about 46 | 8 | As above; one shard holds 515 s, another 1,031 s |
| One Node at 3 shards plus the subset on the other | 7.2 min | about 24 | 4 | As the one-Node row |
| e2e, pytest and harness-fixture files (119 files, 1,190 s) only on `cand/*` and `main` | 12.6 min elsewhere | about 26 elsewhere | 2 | That signal on `cez/*` and other branches (whether the process reads it is topic `ci-run-triggers`) |
| The top 40 files only on `cand/*` and `main` | 8.3 min elsewhere | about 18 elsewhere | 2 | Same, broader: includes daemon and scheduler tests |
| `isolate: false` | about -0.5 min | about -1 | 2 | Per-file isolation for tests that start daemons and change env; Vitest's own hint in the log: "at least ~27.54s faster" |
| `pool: 'threads'` | not determined | - | 2 | 6 test files call `process.chdir` or `process.exit`, which workers do not support (inferred) |
| `maxWorkers: 4` | not determined | - | 2 | Wait-bound files (20%) gain; CPU-bound files contend for 4 vCPUs. Needs a measurement |
| Larger runners | - | - | - | Not available: the organisation is on the Free plan (`gh api orgs/hearsay-tools`: `plan.name "free"`); larger runners need Team or Enterprise Cloud (docs) |

The Free plan's limit is 20 concurrent standard jobs (docs, limits reference); sharding spends that limit to buy wall time.

### 5. Reruns

7 of 1500 runs (0.47%) have `run_attempt` 2, each re-running only the failed Node job (B). Causes on attempt 1: `e2e/stop-gap` twice (cand/006-62, cand/0.1.192), `daemon/escaped` (cand/0.1.185), `e2e/pi` (cez/96a798b2), `e2e/shipped-plugin` (main c340e13b; attempt 2 failed again, the npm defect), `daemon/lifecycle` (main), `harness/hung-daemon` (main). Five of seven were Node 22.

## Recommendation

1. Run the full suite on Node 22, the engines floor (`>=22.13`) and the version with the only real one-version defect and the larger flake share, and only the 47 version-sensitive files on Node 24. About 45% fewer job-minutes, no change in wall time, and the second-draw flake reds (112 of 1500 runs) drop with it.
2. Then shard that one full run 3 ways if wall time matters more than concurrency: about 7 min Test instead of 19, 4 jobs per run.
3. The e2e, pytest and fixture families (36% of file time) are the natural cut for any branch that does not need them; which branches those are is topic `ci-run-triggers`.
4. Leave pool and isolation alone: `isolate: false` saves about 30 s by Vitest's own estimate and `threads` conflicts with `process.chdir`.

## Open questions

- Is `maxWorkers: 4` faster on a 4 vCPU runner? Not determined, because it needs CI runs; a wave-0 measurement: one branch, 3 runs each at 3 and 4 workers, same SHA.
- Shard walls assume per-file times hold on a shard; a wave-0 run of `--shard=1/3` to `3/3` on one SHA would confirm.
- The `ENOTEMPTY` cause on Node 22 is inferred; a single-file loop on a Node 22 host could reproduce it.
- The suite grew 75% in five days; any option above shrinks with it, not instead of it.

## Sources

- GitHub runs, jobs and job logs of `hearsay-tools/squeal`, read 2026-10-15 via `gh run list`, `gh api repos/hearsay-tools/squeal/actions/runs/<id>/jobs?filter=all`, `gh api .../actions/jobs/<id>/logs`. Parsing and simulation scripts were kept out of the repository (instruction: this file only).
- `gh api orgs/hearsay-tools`: `plan.name "free"`, 4 public and 3 private repositories.
- GitHub-hosted runners reference: https://docs.github.com/en/actions/reference/runners/github-hosted-runners (public: 4 CPU, 16 GB; larger runners on Team and Enterprise Cloud).
- GitHub Actions limits: https://docs.github.com/en/actions/reference/limits (Free: 20 concurrent jobs).
- Vitest, Improving Performance: https://vitest.dev/guide/improving-performance (isolation, pools, sharding with blob reports).
- Vitest 5.0.3 source, `dist/chunks/index.DpLw24bj.js`: `getDefaultThreadsCount`, `BaseSequencer.shard`, `BaseSequencer.sort`.
- Repository at 811efaed: `.github/workflows/ci.yml`, `vitest.config.ts`, the test and source files named above; commit 65acfe0b.
