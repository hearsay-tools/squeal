# 014-02: measuring the processes and the host

Research for spec 014 (`squeal ps`), brief `process-measurement-brief.md`, 2026-10-21. Linux 6.8.0-147, 24 CPUs, Node v24.21.0 (libuv 1.52.1), live daemons Squeal 0.1.234 and 0.1.235 running Vitest 4.1.10 (cezar's install). The live host was read only through `/proc`, `/sys`, `ionice -p` and the cezar store opened `readOnly`. No daemon socket was opened and no process was signalled or reniced. Probes: `probes/process-measurement/` (throwaway). Every timing names the one-minute load beside it.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | CPU | Two `/proc/<pid>/stat` samples 2 s apart. Against the centred 10 s reading, a daemon's 90th-percentile error is 31 to 33 points of one CPU at 0.5 s and 1 s, and 17 to 18 at 2 s; the median is 4 to 7 points at every interval. The lifetime average was more than 5 points off the last 10 s for 12 of 22 daemons. Vitest thread workers are threads named `WorkerThread`, and each one's CPU can be read by its tid. They carry no mark or lane. | verified by experiment |
| 2 | Memory | Per process: `RssAnon + RssShmem` and `VmSwap` from `status`. These equal USS within 0 MiB for all 22 daemons. The total is the sum of those values and counts nothing twice. Summed RSS counts the shared node binary once per process (+13 to 15%). PSS gives the same total, but it costs about 1.1 s of kernel CPU per snapshot. From outside, full `smaps` splits a daemon into JS heap (256 KiB anonymous mappings), mimalloc, glibc heap, other anonymous memory and file pages. | verified by experiment |
| 3 | Attribution | Readable from outside: the daemon (by ppid ancestry, process group or the mark's token), the lane (the mark), the runner (cmdline), the files of node:test and pytest (cmdline), nice (`stat`), ionice (`ionice -p`), and descendants and their totals (the ppid tree). Only the daemon knows which Vitest worker runs which file. The store gives the files of each run in flight. | verified by experiment; node:test and pytest read in source code |
| 4 | Host | `/proc/loadavg`, `/proc/pressure/{cpu,memory,io}`, `MemAvailable`, swap used, and `os.availableParallelism()`, which follows both the CPU affinity and a cgroup's `cpu.max`. Squeal's CPU share = Squeal's CPU over the window ÷ the host's busy CPU from `/proc/stat` over the same window. Squeal's memory share = Squeal's private memory ÷ (MemTotal − MemAvailable). Swap is stated apart. macOS: not determined. | verified by experiment; macOS not determined |
| 5 | Cost | Synchronous reads without `smaps`: 57 to 126 ms wall and 60 to 85 ms CPU for 617 to 647 processes at load 41 to 45. The CPU window adds its own length. `smaps_rollup` for the ~60 Squeal processes adds 1.1 to 1.6 s wall and 1.05 to 1.2 s of CPU. Reads through the libuv thread pool cost 3 to 8 times the CPU of synchronous ones. | verified by experiment |

## Findings

### 1. CPU

- **Interval.** `cpu-intervals.mjs` sampled 21 to 22 daemons and 37 to 38 marked test processes every 250 ms for 60 s, twice: at load 35 to 39 and at load 45 to 38. It compared each window's reading with the centred 10 s reading. The results, in points of one CPU (run 1 / run 2): *Verified by experiment* (`logs/cpu-intervals-{1,2}.txt`).

  | Window | Daemon median | Daemon p90 | Test median | Test p90 |
  |---|---|---|---|---|
  | 0.5 s | 4.7 / 7.2 | 31.3 / 32.0 | 3.7 / 6.1 | 19.8 / 26.9 |
  | 1 s | 4.3 / 6.0 | 33.2 / 31.1 | 2.8 / 4.0 | 15.8 / 23.4 |
  | 2 s | 3.8 / 4.7 | 18.0 / 17.2 | 1.5 / 2.6 | 11.3 / 18.6 |

  The work is bursty: a daemon's reading swings by up to 58 to 68 points from one window to the next (p90). Going from 0.5 s to 1 s gains nothing at p90; going from 1 s to 2 s halves the daemons' p90. With `USER_HZ` 100, one tick is 2 points at 0.5 s, 1 point at 1 s and 0.5 points at 2 s.
- **Lifetime average.** `(utime + stime) / age` was more than 5 points away from the last 10 s for 12 of 22 daemons. For example: 0.4 now against 10.6 lifetime (pid 3546894); 43.2 against 21.8 (2128703). It describes the past, not what occupies the host now. Cumulative CPU time is a separate, honest number. *Verified by experiment.*
- **Threads.** Vitest 4.1.10's `ThreadsPoolWorker.start` calls `new Worker(this.entrypoint, { env, execArgv, stdout, stderr })` with no `name` (`vitest/dist/chunks/cli-api.BK8pd4xc.js:3162`). *Read in source code.* In Node v24.21.0 such a thread appears in `/proc/<pid>/task/<tid>/comm` as `WorkerThread`, and its ticks can be read per tid: 199 for the busy worker, 7 for an idle one. A worker given `name` shows that name instead. A worker's `env` does not appear in `/proc/<pid>/environ` (`logs/threads.txt`). *Verified by experiment.* Every live daemon already runs one `WorkerThread` of its own (`logs/snapshot-2.json`, `threadNames`), so the pool's threads would be the extra `WorkerThread`s. *Inferred*: no live project uses the threads pool, so none was observed. Threads share one address space, so their memory cannot be split by thread. Daemon 3704612 runs 60 `rolldown-worker` threads (Vite 8's bundler), which are not test threads.

### 2. Memory

- **What equals what.** In `logs/snapshot-2.json` (load 43), each daemon's `RssAnon + RssShmem` from `status` minus its USS from `smaps_rollup` (`Private_Clean + Private_Dirty`) is 0 MiB for all 22 daemons. For fork workers it is within 7 MiB, except three processes whose memory changed between the two reads (−25, −44, −124 MiB). RSS − PSS is 54 to 70 MiB for every process: the node binary's and the libraries' file pages, which every process maps. Fork workers share no anonymous pages with the daemon, because Vitest starts them with `child_process.fork` (`cli-api…js:3084`), a new exec. Totals over 58 processes: RSS 24,037 MiB, PSS 21,299, USS 21,241, `RssAnon + RssShmem` 20,991 (98.6% of PSS), `RssFile` summed 3,046, `VmSwap` 1,021. *Verified by experiment; the fork reason read in source code.*
- **What to show and sum.** Per process: private memory, `RssAnon + RssShmem`, and swap, `VmSwap`. Both are in `status`, which costs 2 to 3 ms for all of them. Sum the same two values: a total of private memory counts nothing twice. It leaves out each process's part of the shared file pages, 1.4% here. Never sum RSS. *Inferred from the measurements above.*
- **Swap.** The host's swap was full: `SwapFree` was 1,364 kB, then 144 kB, of 4,194,300 kB. Squeal's processes held 1,019 to 1,021 MiB of it, a quarter of it, and the four largest daemons held 80 to 264 MiB each. This memory is not in RSS. *Verified by experiment.*
- **Inside a 2 GB daemon.** Full `/proc/3704612/smaps` (5.5 MB of text, 207 ms wall, 186 ms CPU) for RSS 2,235 MiB: 6,330 anonymous mappings of exactly 256 KiB held 1,572 MiB, `[anon:mimalloc]` 261 MiB, `[heap]` 109 MiB, other anonymous mappings 224 MiB and file pages 68 MiB. `VmData` was 4.2 GB (`logs/smaps-breakdown-3704612.json`, `smaps-anon-sizes-3704612.json`). *Verified by experiment.* The 256 KiB mappings are the JS heap: in `v8-pages.mjs`, 4 million objects grew them by 603.6 MiB while `heapUsed` grew by 603.8 MiB. A 300 MiB `Buffer` landed in other mappings instead (`logs/v8-pages.txt`). *Verified by experiment.* Reading `mimalloc` as Rolldown's native allocator and `[heap]` as glibc malloc (SQLite and other native code) is *inferred*. V8's large objects fall outside the 256 KiB mappings, so this split is an estimate. The exact heap is `process.memoryUsage()` inside the daemon, and no Squeal source reads it today: `grep memoryUsage src` finds nothing. *Read in source code.*

### 3. Attribution

- **Daemon.** The daemons were found by cmdline (`squeal.mjs` followed by `daemon`) among processes whose `comm` is `MainThread`: Node 24 renames its main thread. In snapshot 2, all 36 test-side processes descended from a daemon through the ppid tree of one `stat` scan: 25 carried a mark and 11 did not (tests' own children with their own env, such as `git` and `node …`). In snapshot 1, six processes descended from no daemon and were not in a daemon's group: `agent-browser`, `google-chrome`, two `cat` and two `chrome_crashpad_handler`. They carried the mark `81287f79…:slow:vitest`, the same token as daemon 2974521's fork workers. Chrome's `--user-data-dir` lay under `/tmp/squeal-1001/tmp/<id>/`, a daemon's scratch directory (`logs/snapshot-1.txt`). So the token links an escaped process to its daemon through any sibling that still descends from it, or through the registration's token (014-01). A process with neither a mark, nor ancestry, nor group membership cannot be attributed. *Verified by experiment; the last sentence inferred.*
- **Lane and run.** The mark after the token names the lane: `vitest` and `slow:vitest` were seen. Where runs of one lane overlap, the mark is `<lane>#<runId>` (`afterEachRun`, `src/core/daemon/escaped.ts`). *Verified by experiment; `#runId` read in source code.*
- **Runner and files.** A Vitest fork worker's cmdline ends with `vitest/dist/workers/forks.js`. Its environ holds `SQUEAL_DAEMON_CHILD`, `VITEST`, `VITEST_MODE`, `TEST`, `NODE_ENV`, `NODE_OPTIONS` and `SQUEAL_OBSERVE`, and no test file. Vitest gives files to workers inside the daemon. Open file descriptors sometimes hint at the test (`/tmp/cez-vitest-tmp-*/cez-parity-run-codex-*/…`), but not reliably. *Verified by experiment.* A node:test process is spawned with `--test --test-reporter-destination=<logDir>/events-<i>.ndjson <file>` (`src/runners/node-test/run/run.ts:101-110`). A pytest batch ends with `--basetemp=<dir> <files…>` (`src/runners/pytest/run/run.ts:126-130`). Both are detached into their own group, but still descend from the daemon (`run/process.ts:38-44`). *Read in source code*; no node:test or pytest run was live. The store opened read-only holds each run in flight (`runs` with `ended_at` null: `worktree_id`, `test_files`, `started_at`, `log_dir`) and the keys it claimed (`test_file_keys.pending = 'running'`; 11 worktrees, one with 200). *Verified by experiment.* So the files of a Vitest tier are known; which worker runs which of them is known only to the daemon.
- **Priority.** `nice` is field 19 of `stat`. All 36 test-side processes were at 10 and the daemons at 0. `ionice -p <pids…>` (the `ioprio_get` call, read-only) gave `idle` for `slow:vitest` processes and `none: prio 0` for fast-lane ones. Node has no binding for that call, so one `ionice` spawn per snapshot is needed, or the field is left out. *Verified by experiment.*

### 4. Host

- Read in under 0.3 ms: `/proc/loadavg` (32.5 to 46.4), `/proc/pressure/cpu` `some avg10` (33 to 44), `/proc/pressure/memory` `some`/`full avg10` (0.6 / 0.15 to 0.52), `/proc/meminfo` `MemAvailable` (15.8 to 16.2 GiB of 46.6 to 46.9 GiB) and swap. `MemTotal` changed between two snapshots (48,814,372 → 49,223,972 kB), so it is read at every snapshot. *Verified by experiment.*
- **CPU count.** `os.availableParallelism()` returned 24, 4 under `taskset -c 0-3`, and 2 in a `systemd-run --user --scope -p CPUQuota=200%` scope (`cpu.max` `200000 100000`). `os.cpus().length` returned 24 each time (`logs/parallelism.txt`). The pool already uses `availableParallelism()` (`src/core/capacity/pool.ts:76-78`). *Verified by experiment; read in source code.*
- **cgroup.** All 22 daemons were in one cgroup, `app.slice/cezar.service`, together with the agents that started them. That cgroup's `memory.current` (35 GiB) and `cpu.pressure` describe all of it, not Squeal. It has no `cpu.max` (`app.slice` delegates only `memory pids`). *Verified by experiment.*
- **Squeal's share.** CPU: 733 to 942% of one CPU, 7.3 to 9.4 of 24 CPUs, which was 33 to 41% of the host's busy CPU (92 to 98% busy) in the same window. Memory: private memory was 62.6 to 66.8% of the host's used memory (MemTotal − MemAvailable), plus 1 GiB in swap (`logs/snapshot-{1,2,3}`). *Verified by experiment.*
- **macOS.** Not determined: there is no macOS host here, and no source was fetched. *Inferred* candidates for the spec to check: `os.loadavg()`, `os.availableParallelism()`, `ps -o pid,ppid,pgid,nice,rss,time`, `sysctl vm.swapusage`, `vm_stat`. There is no PSI and no readable environ of another process through `/proc`.

### 5. Cost

`cost.mjs`, three rounds at load 43, 617 to 647 processes, 22 to 23 daemons and 35 to 38 marked processes (`logs/cost.txt`). *Verified by experiment.*

| Read | Wall ms | CPU ms |
|---|---|---|
| `stat` of every process, sync | 19 to 30 | 17 to 39 |
| `cmdline` of the `MainThread`/`node` processes (125 to 132), sync | 5 to 34 | 3 to 7 |
| `environ` of every process, sync (others' fail fast) | 15 to 38 | 15 |
| `status` of Squeal's (58 to 61) | 2 to 3 | 2 to 3 |
| host files | 0.3 | 0.3 |
| `smaps_rollup` of Squeal's | 1,218 to 1,568 | 1,115 to 1,197 |
| `cmdline` of every process, async (libuv pool), for comparison | 78 to 136 | 117 to 142 |

`smaps_rollup` grows with RSS: 202 ms for the 2.2 GB daemon, about 90 ms per GB. Split over four worker threads, it took 452 to 638 ms wall and 1,310 to 1,512 ms CPU (`logs/smaps-parallel.txt`). The ppid tree comes from the `stat` scan, so `task/*/children` is not needed: it cost 15 to 21 ms on its own. The full probe with `smaps` used 1.37 to 1.44 s of CPU, nearly all of it kernel CPU. Without `smaps`, it used 0.28 s with async reads.

## Recommendation for Squeal

1. **CPU (1):** read `stat` twice, 2 s apart, and show "CPU over the last 2 s" per process. Show cumulative CPU time beside it, never a lifetime percent. Count Vitest thread workers as threads of their daemon. The tradeoff: 2 s halves the p90 error against 1 s, and the command takes 1 s longer.
2. **Memory (2):** per process, show private memory `RssAnon + RssShmem` and swap `VmSwap` from `status`. Totals sum the same two values. No `smaps` in the default snapshot. A heap/native/file split of one daemon from full `smaps` (256 KiB mappings) can be an opt-in detail, at about 90 ms CPU per GB.
3. **Attribution (3):** build the ppid tree and groups from one `stat` scan, read `environ` for marks, and tie mark-only processes to their daemon by token. Take the lane from the mark, the runner from `cmdline`, and the files from `cmdline` (node:test, pytest) or from the run in flight (Vitest, per tier, not per worker). Read nice from `stat`, and ionice from one `ionice -p` spawn or not at all.
4. **Host (4):** show load, CPU and memory PSI `some avg10`, `MemAvailable`, swap used, and `availableParallelism()`. Squeal's share = Squeal's CPU ÷ the host's busy CPU in the same window, and private memory ÷ used memory, with swap stated apart.
5. **Cost (5):** use synchronous, serial reads, filtered to `MainThread` processes before reading `cmdline`, all inside the CPU window. That is about 0.1 s wall and under 0.1 s CPU beyond the window on today's host. Never use the libuv pool for `/proc`.

## Open questions and limits

- One host, one load band (32 to 46 on 24 CPUs), Linux 6.8, Node 24.21, Vitest 4.1.10, measured on one morning. The 2 s choice rests on two 60 s runs.
- The threads pool, node:test and pytest were not seen live: none ran on the host. Their findings come from source and from a Node experiment. No daemon of my own was started.
- The memory equalities hold for Node processes that share no anonymous memory. A test's browser shares memory between its processes: Chrome's PSS was 105 MiB against RSS 208 MiB. Their private memory undercounts and their RSS overcounts. Only PSS is exact there, at its cost.
- Mapping a mark's token or a run's `worktree_id` to a daemon pid is 014-01's topic and is not answered here.
- macOS is not determined.
- Whether a daemon should report `process.memoryUsage()` and the file each Vitest worker holds is a spec decision. Reading them would need its socket, which this research did not open.

## Sources

- Squeal at `9060a96c9`: `src/core/daemon/{escaped,terminate,leftovers,low-priority}.ts`, `src/core/capacity/{pool,marks}.ts`, `src/runners/node-test/run/{run,process}.ts`, `src/runners/pytest/run/run.ts`, `src/runners/vitest/{adapter,environment}.ts`; spec 011 C10 (Capacity, Priority) and C13; 001 `research/host-capacity.md`, `research/process-group-tests-under-squeal.md`.
- Vitest 4.1.10: `/home/agent/projects/cezar/node_modules/.pnpm/vitest@4.1.10_…/node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js`, lines 3084 (forks) and 3162 (threads).
- Live host, read-only: `/proc/<pid>/{stat,status,smaps_rollup,smaps,cmdline,environ,cgroup,task/*/comm}`, `/proc/{loadavg,meminfo,stat,pressure/*}`, `/sys/fs/cgroup/…/cezar.service/*`; `/home/agent/projects/cezar/.git/squeal/store.sqlite` (`readOnly`).
- Probes and logs: `probes/process-measurement/` (README lists each script and log).
