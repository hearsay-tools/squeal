# Load slowdown: how much concurrent test load slows each run on this host, and whether Squeal's load pays for itself

Researcher task bb871401, 2026-11-07. The human asked: with about 20 worktrees and Squeal running tests in each, does Squeal slow the pipeline instead of speeding it up? Data: every Squeal store on the host (squeal, cezar, toolkit-dev, saas-bp-management-dashboard, mvp-unveiled-july26), copied with `-wal`/`-shm` at 2026-11-07 09:24Z, with their runs' `report.json` files; sar 10-minute samples from 2026-10-29 23:00Z to 2026-11-07 08:20Z (1,191 samples, 8.3 days); agent transcripts for the same window. Squeal source read at `3b8daeaf3`. This session's worktree (`bb871401`) is out of every count, and its daemon was stopped. No test, build or load was started. The scripts are in `probes/load-slowdown/`.

The window ends at 08:20Z, not 08:45Z: the human ran a CI test on this Proxmox host at about 09:00Z, and the sample that ends 08:30Z already shows 11.2% steal. The 6 later samples are out of every figure (finding 6c lists them).

**Verdict.** Above about 16 busy vCPUs, each test file runs much slower: 1.3 times at 16 to 20 busy, 2 times at 20 to 24. 39% of Squeal's test time and 44% of agents' own test time ran there. Squeal's load made agents' own test runs 7 to 12% slower, about 0.5 to 0.8 hours a day. Squeal saves at most about 0.25 hours a day of runs that can be counted. So by the seconds this data can count, Squeal's background load costs more than it saves. The larger cost is not run speed. It is the time agents wait for Squeal's answers, and that time grows with load: a `squeal status --wait 60000 <file>` call took a median of 8 s at 0 to 6 busy vCPUs and 61 s above 16, where 58 to 67% of the calls reached the limit with no answer. Restart baselines and backlog tiers made 94% of Squeal's work above the knee. Edit tiers made 3%.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Slowdown per load band | busy vCPUs 0–6: 1.00; 6–12: 1.03; 12–16: 1.09; 16–20: 1.30; 20–24: 1.96. The knee is at 14–16 busy | verified by experiment |
| 2 | Exposure | Squeal: 5.5 / 21.6 / 33.6 / 21.8 / 17.4% of its 762 worker-hours per band, 39% above 16. Agents' own runs: 44% above 16 | verified by experiment |
| 3 | Agents' runs: overlap and slowdown | 39% of their time overlapped another agent run, and 88% overlapped Squeal's runs. Estimated slowdown 1.36; without Squeal's load 1.15 | verified by experiment (overlap); inferred (counterfactual) |
| 4 | Net per day and per session | Cost 0.65–0.96 h/day (17–25 s per session). Countable savings at most 0.25 h/day. Waits for answers 6.2 h/day, up to 1.8 h/day of them linked to load | verified by experiment (counts); inferred (attribution) |
| 5 | Who runs above the knee | cezar baselines 47%, cezar backlog 30%, squeal backlog 17%, run --all 2%, edit tiers 3% | verified by experiment; tier kind inferred |
| 6 | SMT off and 12 vCPUs | (a) both a slow rise and a knee; (b) a 12-vCPU cap gives about 10.6 isolated cores of throughput, against 12.4 in the 40% of samples above that; (c) steal is low except for two episodes | inferred from verified curves |

## Method

- **A record** is one test file's module duration (`moduleDuration` in `src/runners/vitest/reporter.ts`: environment setup, prepare, collect, setup and test time) in one run that ended without a failure line. 272,118 records: cezar 182,389, squeal 89,598, toolkit-dev 131.
- **Same content.** The store cannot pair two runs at the same key. `results` keeps one row per check and key and writes with `INSERT OR REPLACE` (`src/core/store/repos/results.ts`), so a later run at a key erases the earlier run's row (read in source code). Revision rows that would give the commit exist for only 9% of runs. Grouping by commit with a clean tree gave 24,762 records but almost no group in two load bands, so that control is not determined. The main control is the same project and file on the same UTC day, in any worktree (20,194 groups). Same file, same worktree and same day gives the same curve (table below). Content drift inside a day, cold caches after an install, and failing tests remain as noise. They do not depend on the load band, except for cold caches in baselines, which the "no baseline" row removes.
- **Slowdown in a band**, per group with records both in the band and in the reference band (0–6 busy): the group's median duration in the band over its median in the reference band. The table gives the median of these ratios, with p25 and p75. A second estimate fits log duration = group + band by alternating medians, on all groups with two or more bands ("FE").
- **Load.** (a) Squeal's concurrency: across all stores, the sum over runs of each run's module seconds divided by its wall (its mean number of files at once), averaged over the record's run. (b) sar busy vCPUs (24 × (100 − %idle)) and %steal of the sample that holds the run's midpoint.

## Findings

**1. The slowdown curve.** `verified by experiment` (`slowdown.py`, day groups):

| Busy vCPUs | Records | Groups | Median slowdown [p25–p75] | FE factor [p25–p75] |
|---|---|---|---|---|
| 0–6 | 12,536 | reference | 1.00 | 1.00 [0.93–1.10] |
| 6–12 | 61,087 | 4,803 | 1.03 [0.90–1.13] | 1.08 [0.97–1.17] |
| 12–16 | 100,521 | 4,869 | 1.09 [0.95–1.23] | 1.12 [1.01–1.27] |
| 16–20 | 65,387 | 4,428 | 1.30 [1.09–1.56] | 1.29 [1.13–1.59] |
| 20–24 | 34,886 | 2,416 | 1.96 [1.48–2.63] | 1.81 [1.44–2.48] |

- In 2-vCPU bands (FE): 1.00, 1.01, 1.07, 1.09, 1.09, 1.13, 1.14, 1.20 up to 16, then 1.28 (16–18), 1.42 (18–20), 1.69 (20–22) and 2.49 (22–24). Up to 14 busy, the slowdown rises by about 1.4% per busy vCPU. From 14 to 20 it rises by about 6% per vCPU, and above 20 by about 25%. **The knee is at 14–16 busy vCPUs.**
- By Squeal's own concurrency (files at once, all stores): 0–4: 1.00; 4–8: 1.05; 8–12: 1.17; 12–16: 1.56; 16–24: 2.56; 24 and more: 3.18 (groups 9,449 / 8,522 / 4,139 / 1,297 / 187).
- The curve holds under each variant (16–20 and 20–24 bands): same worktree and day 1.31 and 1.86; without baselines 1.25 and 1.84; baselines only 1.42 and 2.12; samples with steal under 1% 1.29 and 1.97; cezar alone 1.38 and 2.04; squeal alone 1.14 and 1.43. Squeal's files are short and mostly in-process. cezar's include browser and parity suites.
- Above 20 busy vCPUs the run queue holds more threads than there are vCPUs. Median `runq-sz` (sar -q) is 14 at 12–16 busy, 21 at 16–20 and 35 at 20–24, with a mean 1-minute load of 41. So the top band is CPU queueing, not only shared cores. `%system` grows from 0.5 to 6.0 cores across the bands. `verified by experiment`

**2. Exposure.** `verified by experiment` (`exposure.py`, knee 16). In the window Squeal ran 762 worker-hours, 92 a day. By busy band: 5.5% at 0–6, 21.6% at 6–12, 33.6% at 12–16, 21.8% at 16–20, 17.4% at 20–24, so **39.3% above the knee**. The host spent 20.7% of its samples above 16 busy. Agents' own foreground test runs took 52.1 wall-hours, and 43.6% of that ran above 16. Together, about 40% of all test time on the host ran above the knee. The units are mixed: Squeal's time is in worker-hours, and agents' runs are in wall-hours with unknown worker counts.

**3. The human's hypothesis.** `verified by experiment` (`agent-overlap.py` on 011-181's `extract.py` and `classify.py`). 3,876 foreground agent test runs in 8.4 days, 52.6 wall-hours, median 10.2 s (cezar 2,637, squeal 616). No reviewer ran a locked full suite in the window. cezar workers' own full suites, 201 runs and 17.3 h, take their place.

- **Agents' runs already overlap each other.** 42% of runs overlapped another agent run, for 39% of their time, with 0.54 others on average. Squeal ran during 88% of their time, with 5.9 files at once on average. The hypothesis holds in part: Squeal's runs are almost always present. But agents' own runs are not rare either.
- **Slowdown.** At the load they ran in (mean 14.8 busy vCPUs, 4.0 of them `%nice`, which is Squeal's), the curve gives 1.36. With Squeal's nice cores removed it gives 1.15. `inferred`: this assumes no other work fills the freed cores.
- **Squeal added 3.8 to 6.4 h to these runs, 7 to 12% of their wall.** The high figure applies the curve as measured. The curve is measured on Squeal's own nice-10 files, and agents' runs are nice 0, so under CFS they take a contested vCPU from Squeal. The low figure keeps only the shared-hardware part (the curve held flat above 19 busy, where the run queue stays under 24). For workers: 2,231 runs, 32.2 h, 7 to 13% added. `inferred`
- **Without Squeal, the host would rarely pass the knee.** In the samples above 16 busy, busy minus nice is 14.3 vCPUs on average. Only 60 of those 246 samples would stay above 16 without `%nice`. `inferred`: this assumes agents would not run more tests themselves.
- Repeated agent commands cannot test the curve directly: 87 groups of the same command in a session, and their content changes between red and green runs. Not determined.

**4. Net.** Per day over 8.4 days. Sessions are the 1,164 agent sessions that ran shell commands in a Squeal project.

| Side | Item | h/day | per session |
|---|---|---|---|
| cost | agents' own runs slowed by Squeal's load (finding 3) | 0.46–0.77 | 12–20 s |
| cost | Squeal's edit tiers slowed by Squeal's other work. 4,193 tiers, median 3.7 s, slowdown 1.39 against 1.17 (`edit-tiers.py`) | 0.19 | 5 s |
| cost | reviewers' locked full runs | 0 (none in the window) | 0 |
| savings | named `status --wait` calls that returned before the limit (about 760), each in place of at most one focused run (median 10 s) | at most 0.25 | at most 7 s |
| neither | time in `squeal status --wait`: 3,015 calls, 52 h | 6.2 | 162 s |

- `verified by experiment` Waits on named files with a 60 s limit (1,155 calls, 18.8 h) by busy band: 0–6: median 8.2 s, 19% at the limit (n 72); 6–12: 16.7 s, 30% (179); 12–16: 41.0 s, 44% (366); 16–20: 61.0 s, 58% (352); 20–24: 61.7 s, 67% (186). The excess over the 0–6 median at 12 or more busy is 15.0 h (1.8 h/day, 46 s per session).
- `inferred` That excess is the upper bound of the wait time linked to load. Busy hours are also hours with more edits per worktree, so the bound includes queues that load did not cause. Edit tiers start a median 7.6 s after their revision (151 tiers with a revision row) and run 3.7 s, so most of a 61 s wait is spent before or beside the tier, not in it. The store does not record why the tier waited.
- Not determined: the value of failures that backlog and baselines found in files the agent did not run, and how many runs agents would add if Squeal were off. Both can change the sign of the net. Neither is in the copied data.

**5. Who runs above the knee.** `verified by experiment`, with the tier kind `inferred`: the store does not record why a tier ran. A tier with no checkpoint is counted as an edit tier when it is the first run of its worktree and revision with at most 4 files. Squeal's 299 worker-hours above 16 busy: cezar baselines 141 h (47%), cezar backlog 89 h (30%), squeal backlog 51 h (17%), cezar run-all 7 h (2.4%), cezar edit tiers 7 h (2.4%), squeal edit tiers 2.8 h (0.9%), toolkit-dev 0.5 h. `read in source code`: a backlog or restart-baseline tier counts the host's busy cores (`poolKind`, `src/core/scheduler/capacity.ts`). But `gatedPermits` (`src/core/capacity/cores.ts`) still grants while `grants < hostSlots / 2`, so up to 6 permits start at any host load. An explicit `squeal run --all` tier ignores busy cores. Edit tiers take no permit.

**6. SMT off with 12 vCPUs.** No experiment. No host setting was changed.

- (a) `inferred` from finding 1. Both shapes are present. A slow rise from low load of about 1.4% per busy vCPU, to 1.20 at 16, is the part that SMT-off does not remove: shared L3 cache, memory bandwidth and the all-core clock. The data cannot separate these three. The steeper rise from 14–16, where vCPUs begin to share physical cores, fits SMT sibling sharing. Above 20, CPU queueing inside the VM dominates (run queue 35). With 12 vCPUs, queueing would start at 12 busy instead of 24 for the same demand. A cap helps only if Squeal's demand is cut with it.
- (b) `inferred`: throughput is busy ÷ slowdown, in isolated-speed cores, and this assumes every busy vCPU slows as test files do. At 12 busy it is 10.6, at 16 it is 12.9, at 18 it is 13.3 (the peak), at 20 it is 12.8, at 22 it is 10.5 and at 24 it is 9.6. The host averaged 7.9. A 12-vCPU cap at today's slowdown of 1.13 gives 10.6. 40% of samples did more than that, 12.4 on average, so the cap would cut work in those periods by about 15% and defer about 17 isolated-core-hours a day to idle periods. On SMT-off cores the slowdown at 12 busy could be below 1.13, which would raise the cap's figure toward 12. Note that at 22 to 24 busy the host does less work than a 12-vCPU cap would.
- (c) `verified by experiment` Mean %steal per hour of the day (Europe/Warsaw) is 0.24 to 0.87%, and p90 is at most 1.12%. 0.9% of samples are at 2% or more. Two episodes: 2026-11-04 15:00–16:00Z (3.2 to 7.5%), and 2026-11-07 08:20Z onward (11.2% at 08:30Z, 3.1% at 08:40Z, 3.4% at 08:50Z, 6.5% at 09:00Z, 12.7% at 09:10Z, 0.6% at 09:20Z). The second matches the human's CI test and is left out. Steal correlates with busy (r = 0.45). Other VMs take little CPU time, but steal does not show a sibling thread that another VM holds.

## Recommendation for Squeal (proposals only)

1. **Keep the host at or under about 16 busy vCPUs for background work.** Throughput peaks at 16 to 18 busy vCPUs and falls above 20. Give backlog and baseline tiers a busy-core ceiling of about 16 on this host, that is the physical cores, and drop the `grants < hostSlots / 2` floor for them when the host is above it. Edit tiers can stay outside the budget: they are 3% of the time above the knee.
2. **Spread restart baselines.** cezar baselines are 47% of Squeal's time above the knee. Run them under the same ceiling, or reuse shared results before running them.
3. **Default `hostSlots` from physical cores, not vCPUs minus 1**, where the host exposes them. In a VM it does not, which is why the busy-core ceiling of recommendation 1 matters more.
4. **Measure why named waits reach the 60 s limit at high load.** That cost (up to 1.8 h/day) is larger than the slowdown cost (0.65 to 0.96 h/day). Its cause is not in the store.
5. **Do not cap the VM at 12 vCPUs alone.** The cap removes the SMT part but moves queueing down to 12 busy vCPUs. If the human wants SMT off, combine it with recommendation 1 at a ceiling of 12.

## Open questions

- Not determined: true same-key pairs. The store keeps one run per key. A probe that logs each run's file keys beside `fileDurations` would give them.
- Not determined: why named waits grow with load (queue, yield or quiet period). The daemon does not log the cause.
- Not determined: the shares of cache, memory and clock in the slow rise, and whether other VMs hold sibling threads. Both need host-side counters, which this VM cannot read.
- The edit and backlog split is inferred. The run row does not record its tier kind.

## Sources

- Stores: `<common>/squeal/store.sqlite` (+ `-wal`, `-shm`) and `runs/*/report.json` of the five projects, copied 2026-11-07 09:24–09:26Z and read with `node:sqlite` read-only. 61,807 runs.
- sar: `/var/log/sysstat/sa29`–`sa07`, exported with `sadf -d -U … -- -u` and `-- -q`.
- Transcripts: `~/.claude/projects/*/*.jsonl` (also `subagents/` for test runs) and `~/.codex/sessions/*/*/*/*.jsonl`, 2026-10-29 23:00Z to 2026-11-07 09:20Z, read by `probes/host-load/011-181/extract.py` and `classify.py` (3,971 runs) and by `probes/load-slowdown/squeal-waits.py`.
- Source at `3b8daeaf3`: `src/core/store/repos/results.ts` (`putMany`), `src/runners/vitest/reporter.ts` (`moduleDuration`), `src/core/scheduler/capacity.ts` (`TierCapacity`, `poolKind`), `src/core/capacity/cores.ts` (`gatedPermits`), `src/core/capacity/pool.ts`.
- Earlier results: `host-load/011-181.md`, `host-load.md`, `probes/host-load/README.md`.
- Probes: `probes/load-slowdown/` (README there).
