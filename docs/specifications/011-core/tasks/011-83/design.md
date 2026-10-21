# 011-83: the host cap holds CPU, not test processes, a design for the human

Board row 011-83, a docs-only design draft (brief `tasks/011-83/brief.md`). The human asked for it on 2026-10-21, from the host-load review (`research/host-load.md` 1 and 5). Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in section 6 go into 011 C10 (Capacity), `status.md` gets a dated line, and the board numbers the code rows of section 7.

Sources: `research/host-load.md` 1 and 5; 011 C10 (Capacity) and C4 step 5; `src/core/capacity/pool.ts`, `share.ts`, `marks.ts`; `src/core/scheduler/capacity.ts`, `tiers.ts`, `slow-tier.ts`; `src/runners/vitest/width.ts`; `src/core/daemon/low-priority.ts`; `../014-ps/research/process-measurement.md`; 001 `research/host-capacity.md` (where the free worker came from); the board's rows 001-379 and 014-21. Source at `90e442f7f` (main, 0.1.245).

Probes, all under `probes/` (its `README.md` lists each script and log): the live host read only, through `/proc`, the pool's directory (the permit files' `stat`, the marks' JSON) and the user config, at two moments and in a series of 20 windows of 10 s; and seven test files run one at a time, four times each, in a clone under `/tmp` with its own `HOME`, `XDG_*` and `TMPDIR`. No socket, store or lock file of a live daemon was opened, and no process was signalled. Times are CEST, as in `research/host-load.md`. The one-minute load is beside every timing.

Evidence tags follow `docs/process.md`: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`.

## Summary

- **Most test processes run without a permit.** `capacity.hostSlots` 12 makes 11 permits. Three things run beside them: each daemon's free worker; an edit's tier, up to `runner.tierSize` (4) workers per editing daemon with no permit; and Vitest's floor of 2, so a tier granted only the free worker runs 2 workers. 13 of 23 test processes ran without a pool permit at 22:25, and 17 of 21 at 22:40. In 20 windows of 10 s (22:29 to 22:33, load 41 to 67) Squeal ran 14 to 23 test processes (median 22) against 12 slots, 5 to 12 of them (median 10) in edit tiers. Once there are more daemons with backlog work than slots, every share is 1, so each runs on its free worker and the permits stay free: 18 Vitest daemons would run 36 workers on 12 slots.
- **A held permit is not a running process.** A tier keeps its permits until its last file ends. At 22:29 one daemon held 10 permits and its free worker while one of its workers ran.
- **A test process is not a core.** Per daemon and window, a test process with what it started used 0.35 to 0.99 cores (p10 to p90, median 0.58); one daemon's two workers used 0.72 cores in one window and 2.68 in another. Over the host, 0.49 to 1.09 cores per process. Squeal's process trees used 11.2 to 16.1 cores, of 18.7 to 23.6 busy.
- **The host's niced CPU is a weak stand-in.** It was 0.37 to 0.86 of Squeal's trees' CPU (median 0.68). The tests' kernel time counts as system time, which reached 11.3 cores in one window.
- **A file's CPU is steadier than its wall time.** Over four runs at load 42 to 67, each file's CPU varied by 1.03 to 1.26 times, its wall time by 1.05 to 2.13 times. One file used 12 s of CPU in 80 s.
- **C10's pressure shrink does not exist.** Row 001-379 is planned. No capacity code reads `/proc/pressure/cpu`.
- **Recommendation, four decisions** (next section): every backlog worker takes a permit (no free worker); a tier holds only what it runs; a gate on Squeal's measured CPU, edits' included, above half the slots, which replaces the planned pressure shrink; the default stays the CPU count less one.

## Decisions for the human

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | The free worker (brief question 2). | (a) Inside the pool: the pool is `hostSlots` permits and every backlog worker takes one; a lone daemon still runs `hostSlots`. (b) A host-wide floor: F extra permits only a daemon that holds none may take. (c) As today: one per daemon beside `hostSlots − 1` permits. | (a). An edit's tier does not need it: edits run outside the pool (C10, 2026-10-14). What it buys now is backlog progress for every daemon, and its cost grows with the daemons: 36 to 46 Vitest workers for 18 daemons at 12 slots. Section 2. |
| Q2 | A tier holds what it runs (brief question 1). | (a) A tier returns a permit each time its files not yet ended fall below the permits it holds; a Vitest grant of 1 runs 1 worker unless the project sets `isolate: false`, whose tier takes 2 permits or waits. (b) As today. | (a). Both are counting errors the pool can fix without a new measure. Section 1.4. |
| Q3 | CPU as the measure (brief question 3). | (a) A gate: each daemon measures its own process tree's CPU and writes it in its mark, edit tiers' included; each permit a daemon takes needs the marks' CPU below `hostSlots` cores, or the marks' grants below half the slots. (b) The same gate on the host's niced CPU. (c) A file's last-known CPU as its weight in the grant. (d) Processes only. | (a), and it replaces 001-379's pressure shrink, whose threshold was never set. The sum over daemons is steady enough to gate on; one daemon's ratio is not steady enough to predict a tier; a file's CPU is steady but costs a measurement in every runner. Section 3. |
| Q4 | The default (brief question 4). | (a) The CPU count less one, as today, never above the CPU count, now bounding processes and cores. (b) Half the CPUs. | (a). A lone daemon then runs as wide as the project's own `vitest run`, and a host shared by many worktrees sets its number (this host: 12). Section 4. |

## 1. Today's ceiling (brief question 1)

### 1.1 What the pool counts

| Path | Permit | Counted in the marks | Tag |
| --- | --- | --- | --- |
| An edit's tier (work an edit caused, or a promoted file, C15) | none; `selectTier` asks the pool only for a backlog or turn tier (`tiers.ts:272`) | no mark is written | read in source code |
| A backlog or checkpoint tier, catch-up included | `hostSlots − 1` permit files `pool.<i>.lock` (`pool.ts:238`), plus the daemon's free worker | its grant | read in source code |
| The free worker | one per daemon across its lanes (`pool.ts:216`); every share is at least 1 (`share.ts:53`) | in the grant | read in source code |
| Vitest's floor | a grant of 1 runs `maxWorkers` 2 (`width.ts:12-19`, `tiers.ts:469`) | the grant says 1 | read in source code; verified by experiment (series sample 10: mark grant 1, 2 Vitest workers) |
| A slow tier | `slow.lock` (one per user by default) and pool permits, `slow.maxWorkers` per file | its grant | read in source code |
| An open `squeal run --slow` with no permit | none (C10) | no | read in source code (C10) |
| A pool that fails, an older release | none: the tier runs ungranted (`scheduler/capacity.ts:41`); an older daemon ignores the pool | no | read in source code |
| What a test starts | never counted (C10, D12) | no | read in source code |
| A held permit | held until the tier's last file ends (`tiers.ts:493`) | yes, whether or not a worker runs | read in source code |

### 1.2 The bound

With S = `hostSlots` and N daemons with backlog work, a moment's test processes are at most:

- edit tiers: `runner.tierSize` per editing lane, 4 by default, never waiting;
- backlog tiers: their grants sum to at most S − 1 + N, and each Vitest tier runs at least 2.

So 18 daemons on 12 slots run at most S + 2(N − 1) = 46 backlog workers: one daemon took every permit while it was alone, and a held permit is never taken back, while 17 run on their free worker at Vitest's floor. The review's "about 30" counted the free worker as one process. With 17 of them in edit tiers instead, the bound is S + 4(N − 1) = 80. The steady state is no better. `fairShares` divides S among the N demands and raises every share to at least 1 (`share.ts:53`), so with N above S every share is 1; a daemon whose share is 1 runs on its free worker and takes no permit (`pool.ts:164`, its target less the free one). So 18 Vitest daemons run 2 × 18 = 36 workers on 12 slots while the 11 permits stay free. *Read in source code; the arithmetic inferred.* Cores are processes times what each uses (1.3), and what a test starts below its worker is not in the count at all.

### 1.3 Measured

`probes/host-snapshot.mjs`, two `/proc` scans 10 s apart: each daemon's process tree (the daemon, its marked test processes, everything below them, and the times of the children they reaped), its permits from `/proc/locks`, its mark, and the host's CPU from `/proc/stat`. A test process is a child of the daemon with `SQUEAL_DAEMON_CHILD` at `nice` 10. *Verified by experiment.* A daemon running test processes with no mark runs an edit's tier: a backlog tier's `acquire` writes the mark before it returns the lease (`pool.ts:174`). *Read in source code.*

**Moment 1, 22:25:43, load 44.0 to 46.3, CPU pressure 40 to 42%** (`logs/snapshot-1.json`):

| Daemon | Test processes | Below them | Permits | Mark (want/grant) | Tree cores |
| --- | --- | --- | --- | --- | --- |
| squeal `f98df774` | 11 | 25 | 10 | 200/11 | 9.89 |
| cezar `df65774b` | 4 | 6 | 0 | none (edit) | 2.62 |
| cezar `1f58ba92` | 4 | 3 | 0 | none (edit) | 2.09 |
| cezar `2686d16a` | 3 | 2 | 0 | none (edit) | 2.08 |
| cezar main, slow lane | 1 | 3 | `slow.lock` | 1/1 | 0.26 |
| 9 others | 0 | 0 | 0 | none | 0.0 to 0.1 each |

23 test processes against 12 slots: 12 inside the pool (11 by one daemon on 10 permits and its free worker, 1 slow on a free worker), 11 in edit tiers. Squeal's trees used 17.4 cores; the host was 22.5 cores busy, 10.7 niced, 7.5 system.

**Moment 2, 22:40:30, load 42.3 to 45.9, CPU pressure 47 to 50%** (`logs/snapshot-2.json`):

| Daemon | Test processes | Below them | Permits | Mark (want/grant) | Tree cores |
| --- | --- | --- | --- | --- | --- |
| cezar `2686d16a` | 4 | 7 | 0 | none (edit) | 2.91 |
| squeal `b5e50015` | 2 | 2 | 0 | 200/1, waiter since 22:31 | 2.67 |
| cezar `df65774b` | 4 | 4 | 0 | none (edit) | 2.22 |
| cezar `1f58ba92` (a new daemon) | 4 | 3 | 0 | none (edit) | 1.91 |
| squeal `f98df774` | 2 | 0 | 1 | 121/2 | 1.82 |
| squeal `5c664a42` | 2 | 2 | 1 | 23/2 | 1.81 |
| cezar `14929e5a` | 3 | 11 (6 `git`) | 2 | 3/3 | 1.81 |
| 8 others | 0 | 0 | 0 | none | 0.0 to 0.5 each |

21 test processes against 12 slots, while the pool held 4 of its 11 permits: 12 ran in edit tiers, 9 on grants that sum to 8 (four free workers, and `b5e50015` granted 1 runs 2). Squeal's trees used 15.9 cores; the host was 22.8 busy, 8.6 niced, 7.1 system. `b5e50015` had been a waiter since 22:31 with 7 permits free at 22:40: a tier keeps the grant it started with, so a permit freed during its run does not widen it until its next boundary.

**Series, 22:29:28 to 22:33:21, 20 windows** (`logs/series/`, `probes/series-table.mjs`):

| Measure | Min | Median | Max |
| --- | --- | --- | --- |
| Load, one minute | 41.2 | 53.5 | 67.5 |
| Host busy, cores | 18.7 | 22.7 | 23.6 |
| Niced, cores | 5.9 | 9.0 | 10.8 |
| Squeal's trees, cores | 11.2 | 13.4 | 16.1 |
| Test processes | 14 | 22 | 23 |
| of them in edit tiers | 5 | 10 | 12 |
| Marks' grants (S = 12) | 7 | 14 | 15 |
| Cores per test process, host | 0.49 | 0.66 | 1.09 |

Per daemon and window (n = 119), cores per test process: p10 0.35, median 0.58, p90 0.99. The extremes, 0.12 and 4.5, are tails: in the window of 4.5, ten of a daemon's eleven workers ended and their CPU counted against the one left. With the same width, squeal `b5e50015`'s 2 workers used 0.72 cores in sample 10 and 2.68 in sample 16. In sample 1 (22:29) squeal `f98df774` held 10 permits and its free worker (mark grant 11) and ran 1 worker: its tier's tail. In sample 10 (22:31) the marks' grants were 11 + 2 + 1 + 1 = 15, and squeal `b5e50015`, granted 1, ran 2 Vitest workers. *Verified by experiment.*

### 1.4 Recommendation

Make the count true before making it a CPU measure (Q2 (a)):

- **The tail.** A tier returns a permit each time its files not yet ended fall below the permits it holds. The scheduler hears each module's end already (011-54's `fileEnded`). The free permit goes to the longest waiter at its next look. A Vitest run cannot be made narrower once started, so this returns only what the run will not use.
- **Vitest's floor.** The floor of 2 exists because `isolate: false` with `maxWorkers` 1 hands every file of a project to one worker (`width.ts:5-10`; Vitest 5.0.3 `groupSpecs`, "Non-isolated single worker can receive all files at once"). An isolated project at width 1 runs its files one at a time, each in its own process, as its own runner would. *Read in source code.* So a grant of 1 runs 1 worker unless the project sets `isolate: false`; such a project's tier asks for 2 permits and waits for 2.

## 2. The free worker (brief question 2)

**Why it exists.** 001 `research/host-capacity.md` B took it from make's implicit slot: a shared ledger needs it so a nested daemon cannot be starved by its outer holder, and "that also keeps an edit's tier from ever waiting." The human's decision of 2026-10-14 then put an edit's tier outside the pool altogether (C10, `tiers.ts:272`), so the free worker no longer serves an edit. What it serves today is the backlog: each daemon's baseline, catch-up after a pull, a checkpoint the agent waits on (`squeal run --all --wait`) and the files an edit re-keyed beyond the cut (C4 step 4) move one worker wide (Vitest two) while the pool is full. *Read in source code.* This repository's tests start daemons with their own `XDG_RUNTIME_DIR` (`/tmp/sq-*`, seen on two fixture daemons), so their pool is not the user's. *Verified by experiment.*

**What an edited file waits for.** The edit's own tier (the edited test file, the namesakes, the shortest direct importers, a promoted file) never asks the pool in any option below, and a backlog tier waiting for the pool holds no claim and no lane: `selectTier` lets the edit's tier go first (`tiers.ts:273-276`). *Read in source code.* The options change its wait in two ways only. Its run shares the CPU with every other `nice` 10 process, so fewer backlog processes make it shorter: on this host's store a test took 1.55 times its calm duration at load 24 to 48 and 1.91 times at 48 to 96 (001 `research/host-capacity.md`, p50). And the files the edit sent to catch-up or the backlog wait for a permit.

| Option | Backlog processes at most | The edit's own tier | The edit's catch-up and backlog files |
| --- | --- | --- | --- |
| (a) inside the pool | S | runs at once; less CPU contention than (c) | wait for a permit when the pool is full: until a holder's tier ends or its tail returns one (Q2); C4 step 5 budgets a tier at `max(120 s, its longest file)` of estimated time, with no hard cap |
| (b) host-wide floor of F | S − 1 + F | as (a), with F more processes | the first F daemons with nothing run one worker; the rest wait as in (a) |
| (c) as today | S − 1 + N (Vitest: S − 2 + 2N) | runs at once; contention grows with the daemons | run one worker wide (Vitest two) at once |

**Recommendation: (a).** The pool becomes `hostSlots` permits. A lone daemon gets the same `hostSlots` it gets today. A daemon that gets nothing is a waiter: it is marked (so its share is reserved, the longest waiter first), it holds no claim, and it looks again when its own tiers end and at least every 2 s (the slow lane already re-checks so, at 15 s, `slow-tier.ts:42`). The cost is named: with more daemons than slots, a fresh worktree's baseline can wait one holder's tier before its first file. (b) bounds the excess but keeps a number to tune and still lets F processes exceed the cap; (c) is what the review measured.

## 3. CPU as the measure (brief question 3)

### 3.1 What can be measured, and its cost

| Measure | How | Cost | Gaps | Tag |
| --- | --- | --- | --- | --- |
| A daemon's process tree | its own `stat`, with `cutime` and `cstime` (the children it reaped), plus each live descendant's `utime + stime + cutime + cstime`, twice, as `host-snapshot.mjs` does; the walk of `low-priority.ts` already lists the descendants every second | 014 measured 17 to 39 ms CPU for every process's `stat` on the host; one daemon's tree is a few dozen files | a process re-parented out of the tree (an escaped child) is missed; Vitest thread workers are the daemon's own threads, counted with it | verified by experiment; read in source code |
| The host's niced CPU | `/proc/stat` field `nice`, or `os.cpus()[i].times.nice`, which macOS has too | one read | the tests' kernel time is system time; any other niced process counts; no daemon can tell its own part | verified by experiment (Linux); read in official docs (`os.cpus`) |
| A file's process-tree CPU | Vitest runs each isolated file in its own process (Vitest 5.0.3 stops the runner after each isolated task, `dist/chunks/index.DpLw24bj.js:11549-11558`; 4.1.10, cezar's, not read); the recorder in that process (C12) can read `/proc/self/stat` at the module's end; a node:test process the same; pytest per batch only | one read per file, and a stored value per file | the daemon does not know which worker runs which file (014 finding 3); macOS gives a process's own CPU, not its children's | read in source code; inferred |

### 3.2 Stability

**Sums over daemons are steady.** In the 20 windows, Squeal's trees used 11.2 to 16.1 cores (median 13.4) while the load moved from 41 to 67. *Verified by experiment.*

**One daemon's ratio is not.** Cores per test process, per daemon and window, spread from 0.35 to 0.99 (p10 to p90); at the same width of 2, one daemon used 0.72 cores in one window and 2.68 in another. Which files run decides it, so a daemon's last ratio does not predict its next tier. *Verified by experiment.*

**The niced CPU drifts against Squeal's.** Its ratio to Squeal's trees was 0.37 to 0.86 (median 0.68). The gap is kernel time: system time was 5.5 to 11.3 cores. *Verified by experiment.*

**A file's CPU is steady.** `probes/file-cpu.sh`, each file 4 times in the clone at `nice` 10 and `--maxWorkers=1`; CPU is user plus system of Vitest's process and the processes it waited for, so each includes Vitest's start (about 1.0 s, the first row). *Verified by experiment* (`logs/file-cpu.tsv`).

| File | Load | Wall s | CPU s | Cores | Wall max/min | CPU max/min |
| --- | --- | --- | --- | --- | --- | --- |
| `test/text.test.ts` | 44 | 1.18 to 1.60 | 0.96 to 1.04 | 0.65 to 0.86 | 1.36 | 1.08 |
| `test/capacity/share.test.ts` | 44 to 48 | 2.94 to 3.24 | 1.45 to 1.65 | 0.48 to 0.56 | 1.10 | 1.14 |
| `test/capacity/pool.test.ts` | 49 to 50 | 4.02 to 4.52 | 1.73 to 1.79 | 0.39 to 0.43 | 1.12 | 1.03 |
| `test/scheduler/capacity-pool.test.ts` | 50 to 67 | 10.51 to 22.42 | 7.33 to 9.27 | 0.41 to 0.70 | 2.13 | 1.26 |
| `test/daemon/busy-edit.test.ts` | 42 to 62 | 80.19 to 83.98 | 10.66 to 12.92 | 0.13 to 0.15 | 1.05 | 1.21 |
| `test/runners/vitest/child-env.test.ts` | 42 to 46 | 5.16 to 6.67 | 4.59 to 4.82 | 0.71 to 0.93 | 1.29 | 1.05 |
| `test/runners/vitest/run.test.ts` | 45 to 49 | 12.17 to 13.44 | 8.89 to 9.37 | 0.66 to 0.76 | 1.10 | 1.05 |

All 28 runs passed. The file that varied most in CPU (1.26 times) is the one whose load moved most (50 to 67), and its system time grew with it (1.71 to 3.10 s): load inflates a file's CPU through its kernel time, far less than its wall time. `busy-edit.test.ts` holds one process for 80 s at 0.14 cores: under the count it costs a slot, under the gate it costs what it uses.

### 3.3 Options

- **(a) A gate on measured trees.** Each daemon with a tier running writes its tree's CPU over the last mark refresh (10 s, `MARK_REFRESH_MS`) into its mark, edit tiers included; a tier whose first window has not ended counts its workers as one core each. At a boundary each permit a daemon takes, within its fair share, needs the fresh marks' cores (its own included) below `hostSlots`, or the marks' grants below half of `hostSlots`. So the backlog always holds about half the slots and moves. An edit's tier never waits; its CPU makes the backlog shrink toward half. The gate reads the last 10 s, so a tier of heavy files admitted under it uses more until its daemon's next boundary. This is C10's Size rule ("shrink toward half of them while CPU pressure is above a threshold") with Squeal's own measured CPU in place of the host's pressure.
- **(b) The same gate on the host's niced CPU.** One read and no mark change, but it undercounts by the kernel time (0.37 to 0.86), counts any niced process, and every daemon shrinks alike whoever is heavy.
- **(c) A file's last-known CPU as its weight.** The most exact before a tier starts. It needs the recorder or each runner to measure per file, a stored value per file, and has no answer for pytest's batches or macOS's children.
- **(d) Processes only**, with Q1 and Q2 fixed. Bounds processes at S, but cores still swing with the files (0.12 to 4.5 per process).

**Recommendation: (a).** It gates on the sum, which is steady, not on one daemon's ratio, which is not. It counts the kernel time and the children (b misses), reads only the daemon's own processes, and needs no runner change (c does). The planned pressure shrink (001-379) is the same rule with an input that measures everyone's waiting, agents' included, and its threshold waits on a calm-host probe (001-380) that has not run: (a) replaces it. On a host without `/proc` (macOS) the gate is off and the pool counts processes, as today. (c) stays the next step if a daemon whose tiers mix light and heavy files makes the gate swing.

## 4. The default (brief question 4)

`hostSlots` defaults to `availableParallelism() − 1` (`pool.ts:78`), which follows a cgroup's `cpu.max` (014 finding 4). Nothing stops a user number above the CPU count. This host's 12 is half its 24 CPUs; at 12 and with today's gaps, Squeal still used 11 to 16 cores and the host stayed 19 to 24 cores busy (1.3).

**Recommendation: (a).** Keep the CPU count less one, and cap a user's number at the CPU count when the daemon loads it, with one note. Under Q3 (a) the number bounds processes and cores both, so on a laptop with one daemon the baseline runs as wide as the project's own `vitest run`, while a host shared by many worktrees sets its number, as this one does. (b), half the CPUs, is Vitest's watch-mode width: it would make a lone daemon's baseline up to about twice as slow (*inferred*) to protect hosts that can already say so.

## 5. Rejected options

- **Edit tiers take permits.** Delivery would wait on another daemon's backlog. The human chose edits outside the pool on 2026-10-14; Q3 (a) counts their CPU without making them wait.
- **Preempting a running Vitest tier** to return a permit mid-run. Vitest reads `maxWorkers` at a run's start (probe P1, task 001-378), so narrowing means a cancel, which re-runs files. The tail release returns only what the run will no longer use.
- **The free worker per lane.** 001-376 decision 5 chose one per daemon; per lane adds processes.
- **A cgroup `cpu.max` or `CPUWeight` per daemon.** It caps nothing across daemons and is not portable (001 `research/host-capacity.md` D).
- **Memory as a measure.** Not this row's question; 011-84 covers daemons that should be gone.

## 6. Spec text drafts (011 C10, Capacity)

Replacements for the named bullets. Unchanged sentences are left out.

- **Slot** (replaces the first bullet): A **slot** is one test process Squeal starts, a Vitest worker, a node:test process or a pytest process, and one core of the CPU that Squeal's tests use, with what they start. The host's slots bound both: backlog and checkpoint tiers hold one permit per process (below), and take no new permit while their CPU is over the slots (Size).
- **An edit's tier** (adds a sentence): Its daemon writes its mark while it runs, with the CPU its tests use, so that backlog tiers shrink while edits run (Size); it still never waits.
- **Backlog and checkpoint tiers** (replaces "Every daemon may always run one backlog worker without a permit." and the sentence on a warmup): No daemon runs a backlog worker without a permit. A tier that finds none it may take waits as a waiter, marked, with no claim, and looks again when its own tiers end and at least every 2 s. A running tier is never preempted, so a daemon that starts beside another's baseline waits at most until a holder's tier ends or returns a permit (below) for its share. A tier returns a permit each time its files that have not ended are fewer than the permits it holds (amended on the human's acceptance, row 011-83).
- **Size** (replaces the bullet): The host's slots default to the CPU count minus one, and a larger user number is cut to the CPU count, with one note. Each daemon with a tier running measures, at each refresh of its mark, the CPU its process tree used since the last one: its own, its test processes', what they started, and the children they reaped. Until a tier's first measurement it counts one core per worker. Each permit a daemon takes within its share needs the fresh marks' CPU below the slots, or their grants below half the slots. So backlog tiers shrink toward half the slots while Squeal's tests use more CPU than the slots, edits included, and grow back when they use less. A process re-parented out of a daemon's tree is not measured. Where the daemon cannot read its tree's CPU (no `/proc`), it counts processes only.
- **Runner ceiling** (replaces "at least 2 (with `isolate: false` one worker takes every file of a project) unless the project set 1"): at least 2 for a project with `isolate: false` (one worker would take every file of the project), whose tier asks for 2 permits and waits for 2, unless the project set 1.
- **D10 and D12** (the last bullet's end): the permits count what Squeal starts; the CPU measure counts what those processes start too, while they stay in the daemon's tree.

C4 step 5 says W is "for Vitest its `maxWorkers` at that grant, at least 2": it follows the Runner ceiling's new floor. That sentence is 011-82's ground (section 7).

## 7. Code rows, in order

1. **011-83a: every backlog worker takes a permit** (Q1 (a)). Seam: `src/core/capacity/pool.ts` (`#take` up to `hostSlots`, no `free`), `share.ts` (no floor of 1: shares may be 0, the longest waiters first). Owned: those two, `src/core/scheduler/capacity.ts`, the wait in `tiers.ts` and `slow-tier.ts` (a waiter looks again every 2 s), `test/capacity/`. Red first: two daemons on 2 slots, the second's `acquire` returns `null` while the first holds both (today it returns its free worker); `fairShares(2, three demands)` gives one daemon 0; a scheduler whose backlog tier found no permit starts it within 2 s of a permit's release, having held no claim; a lone daemon still gets `hostSlots`.
2. **011-83b: a tier holds what it runs** (Q2 (a)). Seam: `PoolLease.shrinkTo` driven from `fileEnded` in `tiers.ts`; `src/runners/vitest/width.ts` (`tierWidth` floors at 2 only for `isolate: false`). Owned: those, `test/scheduler/` and `test/runners/vitest/` width tests. Red first: a tier of 3 files granted 3 holds 2 permits after its first file ends, and its mark says 2; an isolated project at grant 1 runs `maxWorkers` 1; an `isolate: false` project at grant 1 asks for 2. Risk to check first: Vitest puts an isolated project whose resolved `maxWorkers` is 1 into a sequential group of its own (`groupSpecs`), so `tierPart` (the `Widths` groups, read from the configs at start) must agree at a written width of 1.
3. **011-83c: the CPU gate** (Q3 (a), Q4 (a)). Seam: a new `src/core/capacity/cores.ts` (the tree's CPU, with the reaped children's times, from the descendants the walk lists); `marks.ts` (additive fields: `cores`, and a mark with no backlog demand, `want` 0, for an edit's tier); `pool.ts` (the gate); `src/core/daemon/user-config.ts` (the cap at the CPU count). Owned: those and `test/capacity/`. Red first: marks summing 13 cores with 7 of 12 slots granted, `acquire` takes no permit; the same with 5 granted takes one, to 6; a fixture tree whose child ended between two refreshes counts the child's CPU; an edit's tier writes a mark and starts without waiting; `hostSlots` 48 on 24 CPUs loads as 24 with a note. Row 001-379 is dropped in its favour, and 001-380's probe P2 (its threshold) is no longer needed.

**Overlaps with the other host-load designs.** Row 2's `fileEnded` hook and every wait are in `tiers.ts`, which 011-82 changes (the cancel and the batch). C4 step 5's W is 011-82's text. Row 1's slow-lane wait is in `slow-tier.ts`, beside 011-84's drain of the slow lane. Row 3's measurement is the same tree arithmetic as 014-21 (running), which reads `cutime` and `cstime` for `squeal ps`: one helper should serve both. Row 2's width change is in the Vitest adapter (013 V9). 011-85 shares no seam.

**Compatibility.** An older release reads a mark with `want` 0 as a demand of 1 and keeps one slot for it until it steps down; it ignores `cores`. It keeps its own free worker while it runs, as C10 already allows an older daemon.

## 8. Limits

- One host, one evening, load 41 to 67 on 24 CPUs; the series is four minutes. The 18-daemon peak of the review was not seen again: 14 to 16 daemons were up, 5 to 7 with tests running.
- A window's cores per test process divides the CPU of every process the tree held during the window by the test processes alive at its end, so a tier's tail reads high (the 4.5 above). The sums are not affected.
- The first corrected snapshot came after one that counted a child reaped in the window twice; that run's numbers are not used.
- A daemon with test processes and no mark is read as running an edit's tier. A promoted file's tier is the same kind; a pool that failed would also write no mark, and none was noted.
- The per-file runs include Vitest's own start and use one worker; inside a daemon's tier the file shares a warm instance.
- No node:test or pytest lane ran on the host. Their slots hold one permit each already (C4 step 5) and are not changed here.
- macOS is not measured: the gate is off there by design.
