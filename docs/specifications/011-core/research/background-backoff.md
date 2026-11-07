# Background back-off: a way for background test runs to slow down before they slow the machine, on any machine

Researcher task 78bca3c1, 2026-11-07, for the human's rejection of a fixed 16-vCPU ceiling (task 7d611fc4: "too coupled to this machine, remember it's for others as well"). Data: the stores of squeal, cezar and toolkit-dev with their runs' `report.json` files, copied 2026-11-07 14:52–14:53Z (61,415 runs; the copy for `load-slowdown.md` at 09:24Z had 61,807, and the prune removed the difference); the same sar window as `load-slowdown.md` (2026-10-29 23:00Z to 2026-11-07 08:20Z, 1,191 samples of 10 minutes); a passive `/proc` sampler on this host, 14:53Z onward. Source read at `cfcc96bbd`. This worktree's daemon was stopped (`squeal stop --until-start`) and its runs are out of every count. No test, build or CPU load was started. Probes: `probes/background-backoff/` (README there).

**Recommendation.** Use the **slowdown that Squeal measures in its own test files** as the signal (shape 1), and use one budget for all of the user's daemons. Squeal already records each file's duration. A file that runs 25% slower than its own recent fast runs is the signal on any OS, VM or container, with no core count. Shrink one shared background budget when that ratio stays above 1.25, and grow it by one permit at a time when it is below. Remove the `hostSlots / 2` floor and keep one permit for the longest waiter (shape 5). Shapes 2 to 4 cannot be the main signal: each one needs a threshold that depends on the machine, or it is not available on macOS, Windows or in containers.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Works on any machine, with no host-tuned number? | Shape 1: yes, the threshold is a ratio. It needs 5 earlier runs of a file and gives no signal on a fresh CI runner. Shape 2: Linux only, and its threshold depends on the host (here 7 to 13% at the knee). In a container `/proc` shows the host. Shape 3: already in the code, Linux only, and it needs a core ceiling. Shape 4: hidden in VMs and containers, and gives a count, not a knee. Shape 5: a policy, not a signal | read in source code, official docs; verified by experiment (VM, container) |
| 2 | Replay | Shape 1 (θ 1.25, two windows): background core time above 20 busy goes from 13.6% to 1.3%, and above 18 from 23.0% to 9.4%. 34% of background work starts later: median 20 min, p95 100 min, at most 140 min. Nothing is left at the end. Shape 5 at this host's 12 slots leaves 14.8 h of work unfinished. At the default 23 slots it is worse than today | inferred (model) from verified signal and curve |
| 3 | Several daemons | One budget file in the pool directory, changed at most once a window. Marks carry each daemon's recent ratios. `fairShares` divides the budget instead of `hostSlots` | read in source code; inferred |
| 4 | Recommendation | Shape 1, plus shape 5 with a one-permit floor. Optional on Linux: the daemon's own cgroup `cpu.pressure` as an early brake | inferred |

## Findings

**1. Today's gate already counts CPU. Its limit and its floor are the problem.** `read in source code`. `gatedPermits` (`src/core/capacity/cores.ts`) grants a permit while the fresh marks' cores are below `hostSlots`, or while their grants are below `hostSlots / 2`. A mark's cores are the daemon's measured process tree, the daemon included (row 011-98). A backlog tier also counts the host's busy cores (row 011-182). So shape 3 exists for backlog tiers. The limit is `hostSlots`: by default the logical CPUs minus 1 (`defaultHostSlots`, `pool.ts`), 23 here. This host sets 12 (`~/.config/squeal/config.json`, since 2026-10-27), so the floor is 6 permits at any load. Two more gaps: `createTreeCpu` returns `null` without `/proc`, and then `#gated` returns `want`. So on macOS and Windows no CPU gate runs at all. Also, the store keeps only the latest duration per check and key (`results`, `INSERT OR REPLACE`). The 7-day duration history that shape 1 needs exists only in run reports, which the prune deletes.

**2. Shape 1: the signal tracks the measured slowdown, with no load label.** `verified by experiment` (`signal.py`). A file's reference is the 25th percentile of the same project and file's durations in the 7 days before, once there are 5 of them. Its ratio is duration ÷ reference. 97.3% of 263,693 records had a reference.

| Busy vCPUs | load-slowdown curve | pooled per 10 min, median [p25–p75] (n samples) | 60 s window, all daemons: share above 1.25 | 60 s window, one daemon: share above 1.25 |
|---|---|---|---|---|
| 0–6 | 1.00 | 1.02 [0.99–1.15] (178) | 14.6% | 15.4% |
| 6–12 | 1.03–1.13 | 1.07 [1.02–1.15] (214) | 17.4% | 18.8% |
| 12–16 | 1.09–1.20 | 1.12 [1.06–1.23] (227) | 25.4% | 25.5% |
| 16–20 | 1.28–1.42 | 1.34 [1.19–1.50] (125) | 61.1% | 55.4% |
| 20–24 | 1.69–2.49 | 1.89 [1.62–2.29] (73) | 95.7% | 92.6% |

- At θ 1.25 the 10-minute pooled signal catches 75% of samples at 16 or more busy, and fires in 12% of samples below 12. At θ 1.3 the figures are 70% and 8%.
- The reference must be a low quantile. With the median as the reference, the 16–20 band reads 1.16, because the median itself already ran under load. Reference windows of 3 and 7 days give the same curve within 0.05. A 1-day window reads up to 0.08 lower below 20 busy and 0.12 lower above it.
- In a 60 s window the signal is noisy: it fires in 15% of the windows at low load. One high window must not cut the budget (finding 3).

**3. Replay.** `inferred` (`replay.py`). The model works on 10-minute samples. Background work (backlog and restart baselines, 471.6 core-hours by `%nice`) arrives as recorded. A policy limits background cores, and the work it holds back waits in a queue, first in, first out. All other load is held as recorded: agents' work, their tests, edit tiers and `run --all`. The load-slowdown curve converts cores at a load into work done. The bound for "the longest waiter always runs" is 2 cores, about one permit. The shape 1 controller reads `S(busy) × noise` every 60 s, with the noise drawn from the recorded residuals. The noise flags slightly more readings than the measured 60 s windows (19% against 15% at low load), so the deferral figures lean high. It halves the budget and adds 1 core per window. "Two windows" means it backs off only after two high windows in a row.

| Policy | Background core time above 16 / 18 / 20 busy | Host time above 18 / 20 | Deferred | Delay of deferred, p50 / p95 / max | Left at end | Other work's mean slowdown | Background core-hours |
|---|---|---|---|---|---|---|---|
| Today (recorded) | 34.1 / 23.0 / 13.6% | 13.7 / 7.3% | 0 | — | 0 | 1.316 | 471.6 |
| 5+3: gate at 23 cores (default slots), no floor | 42.1 / 34.7 / 31.7% | 15.4 / 11.4% | 2.4% | 10 / 10 / 10 min | 0 | 1.427 | 526.6 |
| 5+3: gate at 12 cores (this host's slots), no floor | 8.3 / 3.6 / 1.1% | 6.7 / 2.3% | 69.3% | 160 / 390 / 480 min | **14.8 h** | 1.226 | 417.7 |
| Gate at 16 (the knee: host-tuned, for reference) | 42.8 / 3.3 / 0.9% | 6.7 / 2.3% | 33.2% | 30 / 200 / 240 min | 0 | 1.241 | 448.2 |
| **1: slowdown θ 1.25, two windows** | 28.9 / **9.4 / 1.3%** | 10.0 / 2.5% | 33.9% | 20 / 100 / 140 min | 0.01 h | 1.252 | 450.5 |
| 1: θ 1.25, one window | 15.6 / 5.6 / 1.1% | 8.2 / 2.4% | 70.1% | 50 / 200 / 230 min | 0.89 h | 1.239 | 440.0 |
| 1: θ 1.4, two windows | 34.5 / 17.6 / 2.3% | 12.9 / 3.2% | 17.4% | 10 / 50 / 60 min | 0 | 1.264 | 456.6 |
| 2: load per logical CPU ≤ 0.75 (ideal) | 27.5 / 9.8 / 3.3% | 8.4 / 2.9% | 47.4% | 40 / 230 / 270 min | 0 | 1.246 | 452.8 |
| 2: load per logical CPU ≤ 1.0 (ideal) | 35.9 / 21.5 / 3.8% | 12.6 / 3.1% | 24.3% | 30 / 120 / 140 min | 0 | 1.263 | 461.1 |

- Shape 1 at θ 1.25 comes close to the host-tuned 16-core gate above 20 busy (1.3% against 0.9% of background time), with no core count. Above 18 the gate holds more back (3.3% against 9.4%). Time above 20 busy falls from 7.3% to 2.5%. Other work's slowdown falls from 1.316 to 1.252, about 5% faster. Background work needs 4.5% less CPU for the same result. Three seeds give 1.0 to 1.3% above 20 and 34 to 36% deferred.
- "Above 16" stays near 29% because the controller holds the host at the throughput peak: θ 1.25 is about 16.4 busy here. Without Squeal's background work, other load alone is above 16 busy 7.8% of the time, above 18 4.0% and above 20 1.3%, so no background policy goes below those figures.
- Shape 5 alone depends on its slot count. At 23 the gate grants catch-up bursts up to 23 busy, worse than today. At 12 the background cannot keep up: 69% deferred and 14.8 h of work unfinished after 8.3 days, which is starvation. The floor (`MIN`) matters too. At 1 core, shape 1 defers 39% with at most 170 min. At 4 cores, time above 20 rises to 4.8%.
- Shape 2 replays only as load average per CPU (sar keeps `ldavg-1`, not pressure). Median load per logical CPU by busy band is 0.60 at 12–14, 0.75 at 14–16, 0.96 at 16–18, 1.14 at 18–20 and 1.50 at 20–22. A threshold of 0.75 works here, but that number belongs to this VM. The conventional 1.0 lets 21.5% of background time run above 18.

**4. OS pressure signals (shape 2).**
- `verified by experiment` This host has PSI: `CONFIG_PSI=y`, `CONFIG_PSI_DEFAULT_DISABLED` is not set, and `/proc/pressure/cpu` and the user slice's `cpu.pressure` are readable. `squeal ps` already reads `some avg10` (`src/core/ps/proc.ts`, `pressure`). Live CPU pressure `some` per 10 s by busy band (`psi-sample.py`, `psi-analyze.py`), 286 samples, 14:53–15:41Z (47.5 min), so the higher bands have few samples:

  | Busy vCPUs | 0–6 | 6–12 | 12–14 | 14–16 | 16–18 | 18–20 | 20–24 |
  |---|---|---|---|---|---|---|---|
  | Samples | 106 | 104 | 23 | 24 | 11 | 9 | 9 |
  | Host CPU pressure `some`, median [p75] | 0.5 [0.8]% | 1.7 [2.8]% | 5.5 [6.1]% | 7.1 [10.5]% | 12.7 [13.2]% | 19.2 [22.3]% | 29.7 [33.1]% |
  | User slice `cpu.pressure`, median | 0.3% | 1.5% | 4.8% | 6.6% | 12.2% | 18.7% | 29.3% |

  Pressure rises with every band and has no sharp step at the knee. At the knee (14–18 busy) it reads 7 to 13%.
- `verified by experiment` In a Docker container with `--cpus 2`, `/proc/pressure/cpu` and `/proc/loadavg` show the host's values (the same `total`), and `nproc` shows 24. Only the container's own `/sys/fs/cgroup/cpu.pressure` and `cpu.max` (`200000 100000`) show its limit. So host-wide signals and core counts are wrong inside a CPU-limited container. The cgroup's own file is right.
- `read in official docs` "The 'some' line indicates the share of time in which at least some tasks are stalled on a given resource." "Each subdirectory in the cgroupfs mountpoint contains cpu.pressure, memory.pressure, and io.pressure files" ([psi.html](https://docs.kernel.org/accounting/psi.html)). Unprivileged users can register poll triggers with windows in multiples of 2 s (same page). Node: "The load average is a Unix-specific concept. On Windows, the return value is always [0, 0, 0]" ([os.html](https://nodejs.org/api/os.html), `os.loadavg()`). macOS has load average and no PSI (`inferred`: no PSI page names it). The Windows processor-queue counter page returned 404, so its definition is not determined. Node has no API for it.
- `inferred`: pressure inside a VM measures tasks waiting for a vCPU. It does not measure two vCPUs sharing one physical core, which is the likely cause of the 1.30 slowdown at 16–20 busy. On this host it still rises through the knee, because short bursts queue before the mean load fills the CPUs. But the pressure at the knee depends on the machine: a host with more CPUs, or with SMT visible, queues less at the same slowdown. So pressure needs a threshold set for each host, and it fits a brake for real queueing better than the main signal. Comparing pressure with shape 1 over the same minutes needs the two signals at the same times. History has no pressure, so the comparison is not determined.

**5. Physical cores (shape 4).** `verified by experiment`: this VM shows 24 CPUs, `Thread(s) per core: 1`, and `thread_siblings_list` of cpu0 is `0`, so it reports no SMT. The host has 16 cores and 32 threads. `read in official docs`: macOS `hw.physicalcpu` is "The number of enabled physical processor cores in the SoC", with `hw.nperflevels` for performance and efficiency cores ([Apple](https://developer.apple.com/documentation/kernel/1387446-sysctlbyname/determining_system_capabilities)). Windows `GetLogicalProcessorInformationEx` with `RelationProcessorCore` "retrieves information about logical processors that share a single processor core" ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getlogicalprocessorinformationex)). Node's `os.availableParallelism()` "returns an estimate of the default amount of parallelism a program should use" ([os.html](https://nodejs.org/api/os.html)), and none of these core counts is in Node. `inferred`: a physical-core count is a better default for `hostSlots` on bare metal. It cannot see a VM's host or a container's quota, and the slow rise below the knee (cache, memory, clock) has no core count. It can set a better ceiling, not a back-off signal.

**6. How fast a back-off takes effect.** `read in source code`: a permit is held until its tier ends. A lease's `shrinkTo` returns permits only as the tier runs out of files: `fileEnded` shrinks to the files left (`src/core/scheduler/tiers.ts`, row 011-97). `inferred`: a tier's worker count is fixed when it starts, so a budget cut takes effect as tiers end. `verified by experiment`: background tier walls are p50 5–13 s, p90 39–116 s and p99 161–270 s (cezar and squeal, backlog and baseline). So most of a cut applies within 2 minutes, and all of it within about 5. A 60 s window with two windows of hysteresis fits that lag. A faster cut would need running tiers to yield, which costs the files they cut.

## Several daemons on one signal (Q3)

`read in source code`: each daemon reads the other daemons' fresh marks (written every 10 s, `MARK_REFRESH_MS`; fresh for 30 s) at each tier boundary and every 2 s while refused. It then takes its `fairShares` of `hostSlots`, oldest waiter first. `inferred`, the changes:

1. **One budget, not one controller per daemon.** If each daemon halves its own grant on the same high signal, the host loses N halvings at once, and they all grow back together (the replay's one-window case already defers 70%). Keep the budget in one file in the pool directory, `pool.budget`, written by rename like a mark. It holds the budget in permits and the time of its last change. A daemon that finds it older than the window applies one step: halve after two high windows, else add 1 permit. A second daemon in the same window sees the fresh time and does not step again.
2. **Pool the evidence.** Each mark adds the daemon's file ratios from the last 60 s (their count and median, or a small histogram), edit tiers included. Every daemon then computes the same signal from the same marks. With fewer than 5 records the budget holds. Pooling across daemons raised hits at 16–20 busy from 55% to 61% with the same false alarms (finding 2).
3. **`fairShares(budget, demands)` in place of `fairShares(hostSlots, …)`**, and `gatedPermits` without the `grants < hostSlots / 2` term for backlog and baselines. `hostSlots` stays the ceiling of the budget. The floor is 1 permit for the most senior waiter, which `fairShares` already serves first, so background work always moves. Project caps (`capacity.projects`) still apply inside the budget.
4. **Edit tiers and named waits stay outside the budget** (rows 011-98, 011-308, 011-309), but their files feed the signal.

Different users have separate pool directories. Each user's budget sees the others only through the slowdown. Like additive-increase, multiplicative-decrease flows that share a link, they back off together without coordinating (`inferred`).

## Recommendation for Squeal (proposals only)

1. **Signal:** per project and file, the 25th percentile of module durations over the last 7 days (at least 5 records). A record's ratio is its duration over that reference. The window is the median ratio of the records that ended in the last 60 s across the user's daemons, with at least 5 records. This needs a small per-file history in the store, because results keep one row per key. Without a reference (a fresh CI runner, a new file), the record does not count, and the budget stays at today's fair shares.
2. **Controller defaults:** back off at θ = 1.25, only after 2 windows in a row above it; multiplicative decrease ×0.5; additive increase of 1 permit per window at or below θ; floor 1 permit host-wide; ceiling `hostSlots`. Apply it to backlog tiers and restart baselines, which together were 94% of Squeal's work above the knee. A cut stops new grants; running tiers keep their permits until they end (finding 6).
3. **Optional brake, Linux only:** the daemon's own cgroup `cpu.pressure`, read from `/proc/self/cgroup`. It is the only signal that sees a container's CPU quota. Pause new grants while `some avg10` is above about 25%. On this host that is reached only above 20 busy: 19% median at 18–20 and 30% at 20–24, with 9 samples each. The value comes from one host and must be checked on others. Do not use `/proc/pressure` or load average as the main signal: in a container they describe the host, and in a VM they cannot see shared cores.
4. **Separately:** default `hostSlots` from physical cores where the OS reports them (Linux `thread_siblings_list`, macOS `hw.physicalcpu`, Windows `RelationProcessorCore`). This is only a ceiling.
5. **Measure after it ships:** record each budget step (time, budget, signal, record count) in the daemon log, and on the host: (a) background core time above 18 and 20 busy, predicted 23.0% → about 9% and 13.6% → about 1.3%; (b) host time above 20 busy, 7.3% → about 2.5%; (c) the delay from a file going stale to its background result, predicted p50 20 min and p95 100 min for the deferred third; (d) budget halvings per hour and time at the floor, which show oscillation and starvation; (e) false back-offs: windows above θ while the host is under a quarter busy, predicted about 15% of single windows; (f) named-wait times per busy band (load-slowdown finding 4). Repeat (a)–(c) on a machine that is not this VM before any default changes.

## Open questions

- Not determined: how the ratio behaves on a host that is busy all the time, where even the 25th percentile ran under load. The median-reference variant shows the effect (16–20 reads 1.16 instead of 1.34). A floor on the reference age, or an OS signal beside it, may be needed. No such host is in the data.
- Not determined: whether a CPU quota in a container raises file ratios as much as SMT sharing does. No container ran Squeal's tests, and the rules forbid starting load.
- Not determined: the replay holds other load fixed and does not drop background work that a later revision makes stale while it waits. Both effects favour back-off, and neither can be measured from the copies.
- Not determined: the Windows queue-length counter, whose page returned 404, and macOS `host_statistics`, which was not read.

## Sources

- Stores and run reports: `~/projects/{squeal,cezar,toolkit-dev}/.git/squeal/` (`store.sqlite` with `-wal`/`-shm`, `runs/*/report.json`), copied 2026-11-07 14:52–14:53Z, read with `node:sqlite` read-only via `probes/load-slowdown/extract-runs.mjs`. The copies reproduce load-slowdown's exposure: 39.4% of 732 worker-hours above 16 busy (39.3% of 762 at 09:24Z).
- sar: `/var/log/sysstat/sa29`–`sa07`, `sadf -d -U … -- -u` and `-- -q`, cut at 08:20Z.
- Live: `/proc/stat`, `/proc/pressure/cpu`, `/proc/loadavg` and `/sys/fs/cgroup/user.slice/user-1001.slice/cpu.pressure`, every 10 s, 14:53–15:41Z (`psi-sample.py`). One container run: `docker run --rm --network none --cpus 2 postgres:16.1-alpine` printing the pressure, quota and CPU files.
- Source at `cfcc96bbd`: `src/core/capacity/{cores,pool,share,marks}.ts`, `src/core/scheduler/capacity.ts`, `src/core/scheduler/yields.ts`, `src/core/daemon/user-config.ts`, `src/core/ps/proc.ts`, `src/core/store/schema.ts`, `src/core/scheduler/records.ts`.
- Docs, fetched 2026-11-07: https://docs.kernel.org/accounting/psi.html, https://docs.kernel.org/admin-guide/cgroup-v2.html (`cpu.max`, `cpu.pressure`), https://nodejs.org/api/os.html, https://developer.apple.com/documentation/kernel/1387446-sysctlbyname/determining_system_capabilities, https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getlogicalprocessorinformationex. The Windows Server 2003 counter page (`cc940375`) returned 404.
- Earlier results: `load-slowdown.md` (the curve and its probes), `host-load.md`.
