# Fewer Vitest workers per CI shard (row 011-435)

Researcher, 2026-11-27, wave 131. Brief: `../tasks/wave-131.md`, section 011-435. Squeal at `858a4edf1`, which is before the G1 repairs of row 011-429 (released in 0.1.664). Research only. Probe and data: [`probes/ci-shard-workers/`](probes/ci-shard-workers/README.md).

**Recommendation.** Keep Vitest's default workers in the CI shards. Two workers make Node 22 shard 1 take 1.37 times as long. On the slow sandbox they removed none of the failing tests, and no setting showed a failure that the other did not.

## Answers

| Question | Answer | Tag |
|---|---|---|
| Duration, 2 workers against the default (3 on 4 vCPUs) | 1.37 times as long, mean of 8 alternating pairs (1.26 to 1.56). On the fast sandboxes: median 591 s against 425 s | verified by experiment, Vitest 5.0.3, Node 22.19.0 |
| Failed tests, default workers | Fast sandboxes: none in 16 runs. Slow sandbox: every run, 6 to 10 tests | verified by experiment |
| Failed tests, 2 workers (`--maxWorkers=2`) | Fast sandboxes: none in 6 runs. Slow sandbox: every run, 6 and 8 tests, the same files as with the default | verified by experiment |
| G1 files that failed | Only `test/retry/records.test.ts`, only on the slow sandbox, with both settings: default 5 of 5 runs, 2 workers 2 of 2 | verified by experiment |
| Do fewer workers cut G1's rate on CI? | Not determined. 22 runs on fast sandboxes are too few to see a G1 rate near 1 to 2 per 100 runs, and the slow sandbox failed the same way with both settings | inferred |

## Method

Three boat.dev sandboxes of the default type: 4 vCPUs and 8 GB, Ubuntu 24.04. `/proc/cpuinfo` names the CPU only as "AMD EPYC". Two ran at 4.29 GHz (s1, s2) and one at 3.79 GHz (s3); s3 took 2.2 times as long for the same shard. `setup.sh` installs what the CI job `node22` installs (`.github/workflows/ci.yml:55-100`): Node 22.19.0, pnpm 12.15.0, uv 0.12.2, Python 3.10 and 3.13, all 283 release tags. `run.sh` runs `node scripts/ci-shard.mjs --shard 1/6 $SHARD_ARGS` with `CI=true` and `GITHUB_ACTIONS=true`, and resets the machine before each run as a fresh CI job would be. Shard 1 was chosen because it holds the most G1 sightings in the census: `writer-turns` 19, `retry/records` 3, `stop-group-mixed` 3, `stop-slow-wait` 2, `daemon/busy-requests` 1. On CI its Test step took 519 to 768 s in six recent green main runs.

Vitest 5.0.3 runs `availableParallelism() - 1` workers by default (`node_modules/vitest/dist/chunks/index.DpLw24bj.js:10028-10030`), which is 3 here. The sampler confirmed 3 default workers and 2 with the flag. Arms alternated in each sandbox (D F F D D F and the reverse), each after one warm-up run that filled the e2e install cache.

**The first round is flawed and counts only for duration.** It set `VITEST_MAX_WORKERS=2`. Vitest reads that variable into `maxWorkers` for every instance it configures (`index.DpLw24bj.js:14592`). These include the instances that `width.test.ts` creates in-process and the one Squeal's CLI starts in `code-gate-children.test.ts`. So those 9 tests failed in every such run ("expected 2 to be 1"; "up to 2 at once" for "up to 3"). The second round passes `--maxWorkers=2` on the command line instead, and those tests pass. In the first round the duration ratio was 1.39 (10 pairs), the same as the second round's.

## Results

Wall time is the whole `ci-shard.mjs` command. Mean load is the 1-minute average over the run.

| Setting | Sandbox | Runs | Wall s, median (range) | Mean load | Runs failed | Failed files |
|---|---|---|---|---|---|---|
| Default (3) | s1, s2 | 14 + 2 warm-ups | 425 (368 to 496; warm-ups 440 and 506) | 5.0 to 6.7 | 0 | none |
| `--maxWorkers=2` | s1, s2 | 6 | 591 (534 to 774) | 3.4 to 4.4 | 0 | none |
| `VITEST_MAX_WORKERS=2` (flawed) | s1, s2 | 8 | 602 (562 to 644) | 3.5 to 4.2 | 8 | only `width` and `code-gate-children`, 9 tests, every run |
| Default (3) | s3 | 4 + 1 warm-up | 964 (923 to 1132) | 5.2 to 6.0 | 5 | `host-gate` 5/5, `retry/records` 5/5, `proof-*` 5/5; once each `e2e/run-triggers-control` and `harness/opencode/bridge-client` |
| `--maxWorkers=2` | s3 | 2 | 1,200 (1,174 to 1,227) | 3.8 to 4.0 | 2 | `host-gate` 2/2, `retry/records` 2/2, `proof-*` 2/2; once `daemon/handover` |
| `VITEST_MAX_WORKERS=2` (flawed) | s3 | 2 | 1,225 (1,208 to 1,242) | 3.8 to 3.9 | 2 | `host-gate` 2/2, `proof-*` 2/2, the 9 leak tests; once `daemon/handover-tier` |

Pairs, second round, ratio of 2-worker wall time to default: s1 1.26, 1.45, 1.42; s2 1.26, 1.50, 1.56; s3 1.27, 1.26; mean 1.37. The ratio is below the 1.5 that 3 against 2 workers would give for CPU-bound files. A file's time is partly waits for child processes, and the machine is oversubscribed with 3 workers: the load is 5 to 6 on 4 vCPUs.

What failed on s3, with both settings:

- `test/capacity/host-gate.test.ts`, 3 tests, timed out at Vitest's 5 s default (`:158`, `:178`, `:184`), in all 9 runs. Not in the census's G1 file list. It is G1's kind (c), a 5 s default over real work.
- `test/retry/records.test.ts:127`, timed out at 5 s. It is G1 (census kind c), repaired by row 011-429 after this commit.
- `test/cli/proof-copy`, `proof-kept-key`, `proof-not-kept`: at least two of the three in every run. The red side reads `stored: false`, "the gate did not keep it and gave no reason". This is the census's unexplained **flake-0.1.597-storage**, which before this was seen only on boat.dev. A slow sandbox reproduces it in every run.

## Cost to CI

All Node 22 shards weigh about the same (`ci-shard.mjs` balances them by `ci/test-timings.json`), and a CI run waits for its slowest shard. At 1.37 times as long, shard 1's median Test step (574 s over the six runs read) becomes about 790 s: about 3.5 minutes more for every push. The Node 24 and Node 26 jobs run the same script and would slow in the same way. **inferred** from the ratio; not measured on GitHub's runners.

## Open questions

- Whether fewer workers lower G1's rate on GitHub's runners is not determined. A G1 file failed only on s3, and s3 failed it with both settings. Deciding it would take about 100 or more runs a setting. After 0.1.664 removed the G1 bounds, those runs would measure little.
- `VITEST_MAX_WORKERS` in the environment overrides the worker count that Squeal's Vitest adapter gives an instance (the `width.test.ts` failures above). A user who exports it would get their own count, not Squeal's grant. **inferred** from the failures and `index.DpLw24bj.js:14592`; product code not read. Whether the adapter should clear or honour it is a product question.
- s3 reproduces `flake-0.1.597-storage` and the `host-gate` timeouts in every run. boat.dev does not let a caller pick the CPU, so a slow sandbox cannot be ordered. Starting a few and keeping the slow one is the way to get a reproduction machine.

## Sources

- Experiment: boat.dev sandboxes `bx_e3dm3pue`, `bx_35xz2nex` and `bx_v92nzzbr`, 2026-11-27 20:12Z to 23:10Z, $0.30 in all, all deleted. Raw data: `probes/ci-shard-workers/data/`. Table: `node probes/ci-shard-workers/summarize.mjs`.
- CI durations: `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`, Test step of `Node 22 (1/6)`, main runs 46059452731, 46059186065, 46051074967, 46050162965, 46046548428, 46044366995.
- Source at `858a4edf1`: `scripts/ci-shard.mjs:186`, `.github/workflows/ci.yml:22-100`, `vitest.config.ts`; Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js:10028-10030,14592`.
- Census: `ci-flake-census.md` (G1 paragraph, the open question on worker count, Unexplained).
