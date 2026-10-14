# Sharing the host's test capacity across daemons, worktrees and projects

Research for board row 001-372, 2026-10-14. Host: 24 CPUs, 47 GiB, Linux 6.8.0-147, Node 24.21.0, sysstat 12.6.1. Squeal at `03ea82d8`; daemons of 0.1.131 and 0.1.168 were running. Vitest 5.0.3 source, read from an installed copy. Everything here was observed read-only: sysstat logs, `/proc`, `ps`, and the three Squeal stores of uid 1001, opened with `node:sqlite` `readOnly`. No test run, daemon or load was started. The scripts (a `/proc` sampler, a store reader, a join with sysstat) lived in the task's scratch directory and are not committed (brief: commit only this file). Their method is given with each finding.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Measured contention | The host is over one load per CPU in 8 to 52% of each day's 10-minute samples, and over two per CPU in 3 to 32%. Tests then run 1.55× (load 24 to 48) to 3.6× (load over 96) their calm median. Squeal's recorded runs explain little of it: in 106 of the 157 samples above load 48, Squeal was running fewer than 6 workers. Two full-width tiers overlapped for 12 minutes in 7 days. | verified by experiment (read-only measurement) |
| 2 | Unit across runners | One test process Squeal starts. node:test and pytest already read their process count per run (`runner.tierSize`). Vitest fixes `maxWorkers` per instance at 23 here, and `maxWorkers` is part of the environment hash. Slow files already count one permit per file. A slot is not a core, and it does not count memory. | read in source code |
| 3 | Prior art | Make's jobserver is a token pipe inherited down one invocation tree, with an implicit first slot, and tokens are lost on a crash. Bazel's resources (cpu and memory) are scheduled inside one server per workspace. Gradle and Nx run one daemon per build or workspace, with no coordination across them. GNU `sem` is a named counting semaphore in the user's home. Jest and Vitest default to CPUs − 1 for a run and half the CPUs in watch mode. No tool found runs a host-wide broker. | read in official docs |
| 4 | Options | A load-aware daemon is cheap but herds and lags. A ledger already ships for slow files and extends to every lane, but it sees only participants of one uid. A broker can't host runners, because D10 needs a per-process cwd, so it adds a host singleton in front of the same daemons. | read in source code, inferred |
| 5 | Where limits live, and the default | The host number goes in user config, never committed. A project states properties of its tests, not host numbers. A worktree cap has no case in the evidence. With no config: CPUs − 1 host slots, one implicit slot per daemon, and a load-aware backlog. | read in official docs, inferred |

## Findings

### 1. Measured contention

**The host is often overloaded.** *verified by experiment (read-only)*. I read sysstat `sa06` to `sa14` with `sadf -d -- -q -u -r`, giving 143 ten-minute samples a day. Daily 1-minute load:

| day | mean | p50 | p90 | max | samples over 24 / 48 / 72 |
|---|---|---|---|---|---|
| 10-06 | 6.6 | 1.6 | 19.4 | 67.5 | 8% / 3% / 0% |
| 10-08 | 23.7 | 6.0 | 75.2 | 161.0 | 29% / 17% / 12% |
| 10-09 | 37.2 | 25.2 | 96.8 | 181.4 | 52% / 32% / 19% |
| 10-13 | 28.4 | 14.2 | 84.1 | 140.3 | 37% / 24% / 14% |
| 10-14 | 16.5 | 5.9 | 53.3 | 115.6 | 25% / 12% / 3% |

CPU was under 5% idle in 2 to 9% of samples. Available memory fell to 2.6 GiB at 15:50 UTC on 10-13, at load 137. A live `/proc/stat` sample at load 107 to 115 showed 23.8 of 24 cores busy, 59 to 140 runnable tasks and 214 to 432 forks a second. Load swings quickly: it went from 19 to 123 within about three minutes of my samples.

**Load costs test time.** *verified by experiment (read-only)*. Method: 378,511 passing results of at least 20 ms in the squeal store, each joined to the nearest sysstat load sample, and each check's duration divided by its own median at load under 12 (3,117 checks).

| load at record time | n | p50 duration ratio | p90 duration ratio |
|---|---|---|---|
| 0 to 12 | 76,952 | 1.00 | 2.33 |
| 12 to 24 | 69,542 | 1.21 | 3.62 |
| 24 to 48 | 96,026 | 1.55 | 6.12 |
| 48 to 96 | 95,580 | 1.91 | 7.41 |
| over 96 | 33,217 | 3.57 | 15.88 |

Of 12,338 ended runs, 26 crashed and 1 timed out. On this evidence, load costs mostly latency, not failures.

**Squeal's recorded runs are a minority of the load.** *verified by experiment (read-only)*. Method: 12,639 ended runs from the squeal and cezar stores, 10-07 to 10-14 (the mvp-unveiled store had none). Each run's workers were estimated as `min(test files, 23)` and swept per minute.

- The estimated Squeal workers in flight during active minutes were p50 4, p90 14.4, p99 27.7 and max 61.4. They exceeded 24 in 1.0% of all minutes.
- 12,188 of the runs had at most 4 files. Tiers of 24 files or more (236 runs, p50 92 files, wall p50 32 s, p90 178 s) took 8% of run wall time. They overlapped two at a time for 12 minutes and never three.
- At least 2 daemons were running in 784 minutes, at least 5 in 12, and never 8. Two projects were running at once in 118 minutes.
- Above load 48 (157 samples, mean load 81.8), the mean estimated Squeal workers was 6.6. In 106 of those samples it was under 6.

**What fills the rest, at one spike.** *verified by experiment (snapshot)*. I polled `/proc` every 50 ms for 20 s at load 111 to 123, attributing each process's CPU (short-lived ones included) to its owner. Of 18.7 attributed cores:

- About 8 cores were in about ten worktree daemons' trees, none over 2.1.
- 2.9 were Vitest outside any daemon: agents' and reviewers' `npx vitest run`.
- 1.4 to 2 were daemons that e2e tests started under `/tmp`. They are reparented to `systemd --user`, so no daemon's tree holds them.
- Root's `duperemove` used 2.3 to 6 cores.
- The eval runner used 0.2 to 0.8, and uid 1002 (`squeal-e2e` eval cells) 0.2 to 0.3.

This is one snapshot, not a distribution. Memory at that moment: 17 daemons held 7.7 GiB RSS (up to 1.16 GiB each, idle ones included), and 83 Vitest processes held 8.9 GiB.

The board row's incident (one fresh worktree's baseline at 23 workers, about 18 cores, load 42) is the mechanism: Squeal's own share is usually small, but a backlog tier takes the whole host at once.

### 2. The unit of capacity

- **Vitest.** *read in source code*, Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js`.
  - Defaults: `getDefaultThreadsCount` returns `watch ? floor(cpus/2) : cpus − 1`. Squeal creates Vitest with `watch: false` (`src/runners/vitest/adapter.ts:159`), so it gets 23 here.
  - Per-run resize: the pool runs `resolveMaxWorkers(project)` and then `pool.setMaxWorkers` for each task group of every run. A warm instance would therefore honour a `maxWorkers` changed between tiers. It can't change mid-run. Not verified by experiment (probe P1 below).
  - Key impact: `serializeConfig` includes `maxWorkers`, and Squeal's `canonicalConfig` (`src/runners/vitest/environment.ts`) does not drop it. Today it is `undefined` unless the project sets it, so keys don't depend on the host. *Inferred*: a grant written into the config would re-key per grant, and worktrees with different grants would stop sharing results. That needs a key format bump that drops it, while keeping a project's own value as a ceiling.
  - Semantic edge: with `isolate: false` and `maxWorkers === 1`, Vitest gives all of a project's files to one worker. So a grant of 1 changes what the tests share. *Inferred*: never grant a Vitest project fewer than 2 unless the project set 1 itself.
  - A fast tier of at most 4 files uses at most 4 workers. Only backlog and checkpoint tiers (up to 200 files) reach 23.
- **node:test.** *read in official docs, source code*. `--test-concurrency` defaults to `os.availableParallelism() − 1` (Node v24 `doc/api/cli.md`). Squeal spawns one process per file, and its count is read per run from `runner.tierSize` (`src/runners/node-test/adapter.ts:50`).
- **pytest.** *read in source code* (and 007 D6). 007 overrides `-n` to 0 and runs up to `runner.tierSize` batch processes of 5 files (`src/runners/pytest/adapter.ts:43`), read per run. Each process is single-threaded Python, about one core. xdist's own `-n auto` uses physical cores, and `-n logical` needs psutil.
- **Slow lane.** *read in source code* (`src/core/slow/slot.ts`; 004 D2). 004 D2: one permit per slow file, up to `slow.maxParallel` (4), each file running `slow.maxWorkers` (2) workers at `nice` 10.

**A slot is not a core.** *inferred* from the board row and the snapshot in 1. 23 Vitest workers made about 18 cores (board row). An e2e test file's worker starts detached daemons that a worker count does not see. Per-process RSS was 110 MiB on average, up to about 430 MiB. Bazel handles this with crude per-action cpu and memory estimates, not exact accounting.

### 3. Prior art

- **GNU make 4.4.1 jobserver.** *read in official docs*.
  - The pipe is "pre-loaded with one single-character token for each available job". Every child has "one implicit job slot reserved for it before it starts", which "should not be returned".
  - On a crash: "Returning too few slots means that those slots will be lost for the rest of the build". Clients must write tokens back "even under error conditions".
  - The jobserver reaches only commands that inherit its fds or fifo from one top-level make. It is a tree, not peers that find each other.
- **Bazel.** *read in official docs*. `--local_resources=cpu=HOST_CPUS-1` and `memory=HOST_RAM*.5` take a float or keyword expressions. The default is estimated from the system, and the scheduler uses "very crude" per-job estimates. "Each Bazel instance is associated with a single workspace". Nothing on coordination between servers.
- **Gradle 9.8.1.** *read in official docs*. `org.gradle.workers.max` defaults to "the number of CPU processors". `GRADLE_USER_HOME/gradle.properties` takes precedence over the project's. Daemons are reused only on an exact version and JVM match, stop after 3 h idle or on low memory, and the docs describe no coordination between daemons.
- **Nx.** *read in official docs*. "Each workspace starts its own daemon process". It keeps the project graph and stops after 3 h. Its socket lives under `/tmp/.nx/<uid>/sockets`.
- **Jest 30.5.** *read in official docs*. A run defaults to cores − 1. Watch mode defaults to "half of the available cores ... to ensure Jest is unobtrusive". `--maxWorkers=50%` is accepted.
- **GNU parallel `sem`.** *read in official docs*. A counting semaphore named by `--id`, "stored in ~/.parallel/semaphores/", with `-j` accepting `+N`, `-N` and `N%` of the cores.

*Inferred*: no tool here schedules across workspaces with a broker. Coordination is either a token pool shared by convention (make, `sem`) or a per-user setting each process applies alone (Gradle, Bazel rc files). Squeal behaves like a watcher yet takes the run-mode default.

### 4. Options, costs and failure modes

**A. Load-aware sizing per daemon** (no shared state). Before each backlog tier, size workers from free capacity. 004 D3 already does this for slow files with `os.loadavg()` per CPU.

- It sees all load, including the majority that isn't Squeal's (finding 1).
- The 1-minute load lags. Every daemon sees the same idle moment and goes wide together (*inferred*; the swing from 19 to 123 within about three minutes shows how fast the input moves).
- `/proc/pressure/cpu` (PSI, avg10) is present here (`some avg10=35.46`) and reacts in 10 s. It is available per cgroup too.
- Interactions: none with D8, D10 or D12.

**B. Host slot ledger.** It already exists for slow files (`src/core/slow/slot.ts`):

- N lock files `slow.lock`, `slow.<i>.lock` in `$XDG_RUNTIME_DIR/squeal` (`/run/user/1001/squeal` here), each an SQLite exclusive lock that the OS releases on any death. That is better than make's pipe, which loses tokens.
- Non-blocking acquisition, with waiter marks (`slow.wait.*`, fresh for 30 s) so the holder yields between tiers.

Extending it to every lane is incremental. Its limits:

- **It sees only participants.** Above, that is a minority of the load. It also sees only one uid, because the directory is per user. The eval cells (uid 1002) and `npx vitest run` are outside it.
- **Mixed caps.** With different caps per repository, the user-wide total is the largest among running daemons (004 D2, review wave 4 S1). So the cap must come from one per-user source.
- **Old releases.** Daemons of an older release ignore it until they step down. D10 asks no step-down while an older plugin's session is registered, and 0.1.131 was running beside 0.1.168 today.
- **Nested daemons.** An e2e test's inner daemon has its own slot directory by design (004-16), so an outer holder can't starve it. A shared ledger needs make's implicit slot: every daemon may always run one worker without a permit. That also keeps an edit's tier from ever waiting.
- **D8 claims.** Permits must be taken before the `BEGIN IMMEDIATE` that marks keys `running`. Otherwise a claimant waiting for capacity holds a claim that other worktrees wait on for up to `runner.timeoutMs` + 6 s.
- **D10.** No change: a stopping daemon's permits go when its lock goes, and the successor acquires afresh.
- **D12.** No change: it counts what Squeal starts, not what tests spawn.

**C. Host broker daemon with per-worktree runners.**

- **It can't hold the runners.** Vitest runs in the daemon's process with the root as cwd during every runner call (D10). A process has one cwd and one environment, inherited from the hook (D11). The environment hash includes the Node version. So per-worktree runner processes stay: they are today's daemons. The broker adds a host singleton that admits their tiers, which is what B's lock files already do.
- **It concentrates failure.** It is spawned by the first hook, so it lives in that harness's cgroup (`research/daemon-under-harnesses.md` 1; here `app.slice/cezar.service`) and dies when that service is stopped. A hung broker stalls every project, as a hung daemon's accepting socket stalls one worktree today (D10, defect 22).
- **It needs a new handover.** It must accept every release's daemons, or a host-wide step-down must wait until every session of every project on the host has left.
- **Claims get no simpler.** They are already derived from one row and a heartbeat, with no table (D8). Keys are per repository store, so a broker removes no cross-repository case, and claims must still survive a broker restart.
- **What it does offer:** global priority (one worktree's edit tier ahead of another's backlog) and one place to read load. B gets the priority from waiter marks with a class (edit work vs backlog).

**D. Kernel weighting** (complementary). The slow lane already runs at `nice` 10. cgroup v2 `cpu memory pids` are delegated to `user@1001.service` here, so `systemd-run --user --scope -p CPUWeight=` is possible (*inferred*; not run). This yields CPU to agents and builds without counting anything. It caps nothing, though, and does nothing for memory.

### 5. Where limits are configured, and the default

- **Host number.** It goes in user config, for example `$XDG_CONFIG_HOME/squeal/config.json`. Gradle's user-home file beats the project's for `workers.max`. A committed number travels to hosts with other CPU counts. Already seen with `slow.maxParallel`: the cross-repository total became the largest committed value.
- **Per-user, not per-host.** Each uid has its own runtime directory, so the cap is per user. A true cross-uid cap needs a shared system directory and its permission model, which is out of scope here.
- **Project.** The committed `squeal.config.json` should state properties of its tests: a ceiling (the project's own `maxWorkers`, or "these files are heavy"). Not a share of a host it doesn't know.
- **Worktree cap.** No case in the evidence. The incident is one daemon at 23 workers beside non-Squeal load, which a host cap plus load-awareness addresses. Two daemons competing is what the ledger's fair share addresses. A wish for "my checkout first" is a priority, not a cap. If one is ever needed, it is an uncommitted per-worktree setting (environment or the git dir), never committed.
- **Default with no config** (*inferred*): host slots = CPUs − 1, as run-mode Vitest, Jest and node:test use; one implicit slot per daemon; and backlog tiers sized from PSI or load, toward the watch-mode half of the CPUs when the host is busy.

## The coordinator's positions, challenged

**(a) Runner-agnostic slots.** Mostly holds, with three corrections.

- The unit is "a test process Squeal starts", and three of four paths already take that count per run. Vitest needs a key format change, because `maxWorkers` is hashed, and a floor of 2 because of the `isolate: false` grouping.
- A slot isn't a core: e2e workers spawn untracked daemons, and memory isn't counted. A per-file weight (the slow lane's model) covers heavy files better than pretending slots are cores.
- The slots matter only for backlog and checkpoint tiers. Edit tiers use at most 4.

**(b) Three caps over-built.** Holds for the worktree cap and partly for the project cap.

- A worktree cap has no case in the evidence. A project should state a ceiling, not a share.
- "A host cap near the CPU count" alone wouldn't have prevented what was measured. Above load 48, Squeal ran fewer than 6 workers in two thirds of samples. The overload comes from outside Squeal, which only load-awareness or kernel weighting sees.

**(c) Ledger as the middle path; broker a large redesign.** Holds, and more strongly than stated.

- The ledger is not new: it ships for slow files, with crash-safe permits and fairness marks.
- A broker can't absorb the runners, because cwd and environment are per process. It would add a singleton in front of the same daemons.
- Not established: that a ledger is enough. On this evidence it limits the minority of the load that is Squeal's.

## Recommendation for Squeal

1. **Ledger.** Extend the slow-lane permits to every lane as one per-user ledger, with these rules:
   - one implicit slot per daemon;
   - permits taken before keys are marked `running`;
   - backlog tiers yield to edit-tier waiters.
2. **Vitest.** Size each tier's Vitest workers from the grant, after dropping `maxWorkers` from the key (key format bump), with a floor of 2.
3. **Load-awareness.** Size backlog tiers from PSI as well, so load from outside Squeal counts.
4. **Configuration.** The host number goes in user config. The project states a ceiling. No worktree cap.
5. **No broker.**

## Decisions for the human

1. **Host default.**
   - CPUs − 1 (the run-mode convention; fastest baselines, takes the host),
   - half the CPUs (the watch-mode convention; slower cold baselines, unobtrusive),
   - or CPUs − 1 when calm, shrinking toward half under PSI pressure (best fit to the evidence; more moving parts).
2. **Where the host number lives.**
   - A new user-level config file (a new loader and location in D11),
   - or an environment variable only (no file; harder to set for daemons that hooks start).
3. **The project's say.**
   - None,
   - a ceiling only (recommended),
   - or a share (keeps a committed number with host meaning).
4. **Worktree cap.**
   - Drop it (recommended),
   - or keep it as an uncommitted override for a stated case.
5. **Outside load.**
   - Count only Squeal (ledger alone; the measured overload remains),
   - add PSI sizing,
   - and/or kernel weighting (`nice` or CPUWeight for all test processes; caps nothing).
6. **Cross-uid scope.** Accept per-user (eval cells under `squeal-e2e` stay separate), or design a system-wide directory.

## Probes designed, to run later on a calm host

- **P1. Warm Vitest resize.** On a 40-file fixture under Vitest 5.0.3, run the same tier with `maxWorkers` 8, 2 and then 8 on one instance. Count concurrent workers from the pool's `onTaskUpdate` timing. Decides whether a per-tier grant needs a recreate.
- **P2. Throughput against cap.** Run this repo's baseline (`squeal run --all` in a scratch clone, isolated HOME) at 23, 12 and 6 workers, with a fixed background of 12 busy cores. Measure wall time and the background's slowdown. Sets the host default.
- **P3. Ledger fairness.** Run 4 daemons in scratch repos under a test `XDG_RUNTIME_DIR` with 8 permits. Measure the time from an edit to its tier starting while the other three run backlogs. Checks that the implicit slot and edit-before-backlog hold.

## Open questions

- How much of the outside load is agents' `npx vitest run` that Squeal results could replace, and how much is genuinely other work. One snapshot is not a distribution. Not determined, because historical per-process CPU isn't logged here.
- Memory as a second resource: the 10-13 low of 2.6 GiB came with load 137. Whether a memory term is needed is not determined.
- macOS has no PSI and no `/proc`. A load-aware rule needs a fallback there (`os.loadavg()` exists).

## Sources

- sysstat logs `/var/log/sysstat/sa06` to `sa14` (sysstat 12.6.1); `/proc/stat`, `/proc/loadavg`, `/proc/pressure/cpu`, `/proc/<pid>/{stat,cmdline}`.
- Stores, read-only: `/home/agent/projects/{squeal,cezar,mvp-unveiled-july26}/.git/squeal/store.sqlite` (`runs`, `results`).
- Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js`: `getDefaultThreadsCount`, `resolveMaxWorkers`, `Pool.setMaxWorkers`, `serializeConfig`, the `isolate === false && maxWorkers === 1` grouping.
- Squeal `03ea82d8`: `src/core/slow/slot.ts`, `src/core/slow/guard.ts`, `src/runners/vitest/{adapter,environment}.ts`, `src/runners/node-test/adapter.ts`, `src/runners/pytest/adapter.ts`. Spec 001 D1, D5, D8, D10, D11, D12; 004 D2, D3, D7; 007 D6; `research/daemon-under-harnesses.md`; `004-slow-suites/research/slow-suite-runtime.md` 2.
- GNU make 4.4.1, POSIX jobserver: https://www.gnu.org/software/make/manual/html_node/POSIX-Jobserver.html and https://www.gnu.org/software/make/manual/html_node/Job-Slots.html
- Bazel user manual: https://bazel.build/docs/user-manual
- Gradle 9.8.1: https://docs.gradle.org/current/userguide/build_environment.html and https://docs.gradle.org/current/userguide/gradle_daemon.html
- Nx daemon: https://nx.dev/docs/reference/nx-daemon
- Jest 30.5 CLI: https://jestjs.io/docs/cli
- pytest-xdist: https://pytest-xdist.readthedocs.io/en/stable/distribution.html
- Node v24 `--test-concurrency`: https://github.com/nodejs/node/blob/v24.x/doc/api/cli.md
- GNU parallel `sem`: https://www.gnu.org/software/parallel/sem.html
