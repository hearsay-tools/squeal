# 014 squeal ps: dogfooding lessons

Task 014-15, 2026-10-21. The released `squeal ps` of the installed Claude Code plugin, run on this host during ordinary work: three samples 10 minutes apart, two 60 s share windows, and checks of every value and flag against `ps`, `top`, `/proc` and the stores, read-only. Inputs: the brief in `tasks/wave-3.md` (014-15), the spec as amended in `status.md`, `research/process-measurement.md` 4, and two coordinator notes of the same evening (the 0.1.244 release, and the lead that `ps` undercounts Squeal's CPU share).

## Verdict

`squeal ps` shows the daemons, their test processes, the host totals and Squeal's memory as `/proc` shows them. In the three samples it found every daemon process: 16 of 16, 5 of 5, and 16 of 15, where the extra daemon left during the window. Each daemon's pid, version, harness, start and swap equalled an independent read of `/proc`. Its CPU time was within 0.17 s. Its private memory was within 1 MiB for 35 of 36 daemons; the other was 25 s old and growing. The CPU over the sample was within 6.4 points of a second 2 s read that started 118 to 147 ms earlier. The host values matched `/proc` read in the same 2 s.

Three goals do not hold as written:

- **Goal 3, the CPU share.** `ps` reports about half of Squeal's CPU. Over two 60 s windows, the daemons' process trees used 12.5 and 10.1 CPUs, 59% and 49% of the host's busy CPU. That count includes the children that exited inside the window. Six `ps` runs inside the same minutes reported 2.6 to 7.5 CPUs, 12.5% to 39.7%. Test processes and their children that start and exit inside the 2 s window are not counted (Goal 3 below). The memory share holds within 0.6 points of `/proc` in samples 1 and 3. In sample 2 it was 3.6 points low, by the memory of one process that `ps` read as unknown (P4).
- **Goal 4, the flags.** `leftover-temp` lists 22 directories that are not Squeal's leftovers in every sample. Among them are the evals root `/tmp/squeal-evals-1001` (1.4 GiB) and the e2e dependency cache `/tmp/squeal-e2e-cache` (176 MiB). The printed end command, `squeal ps --leftovers | xargs -d '\n' rm -rf --`, deletes them. The other printed flags were true. `ps` connected to no socket and signalled nothing. Its read-only store open can still create a store's `-wal` and `-shm` files (No side effects below).
- **Goal 6, the cost.** One snapshot used 0.35 to 0.71 s of CPU in 15 of 15 runs; the bound is 0.3 s. Node start-up of the bundle alone uses 0.11 to 0.16 s. Wall time was 2.25 to 2.59 s, over 2.5 s in 2 of 15 runs, both at load 33.

In my reading the spec does not move to `shipped` yet. The `leftover-temp` end command deletes data that other tools need, and goals 3 and 6 fail with numbers. Eight defects follow as proposed rows; none is fixed here.

| Goal | Holds? | Evidence |
| --- | --- | --- |
| 1. Every daemon, with its pid, repository, worktree, version, harness, uptime, state, CPU, CPU time, private memory, swap, work and consumers | Yes | Comparison below: 37 daemon readings, values as `/proc` gives them; states checked against the stores; one defect in the work text (P7) |
| 2. Every test process under its daemon, with lane, runner, files or tier, CPU, memory, nice, age and descendants | Yes, with a defect | Lane, nice and start equal to `/proc` for 41 processes. The escaped browser trees were tied to their daemon by token (3 in sample 1, 3 in sample 3). The MEMORY column was `?` in 25 of 47 rows, 17 of them only because a descendant left (P4) |
| 3. Host totals, and Squeal's share of the CPU and the memory | Host and memory share yes; CPU share no | Host values match `/proc`. Memory share 51.0 against 50.4, 31.8 against 35.4 (one unknown process, P4) and 51.4 against 51.8. CPU share about half of the process trees' share (Goal 3 below; P2) |
| 4. Each D7 state flagged with its reason and end command; changes nothing | Partly | `leftover-temp` lists 22 foreign directories (P1); the use check misses bound sockets (P5); a missing `-wal` is created (P6); one transient orphan was flagged (P8) |
| 5. `--json`, `--repo`, exit codes | Yes | Shape `v: 1`. Exit 1 with a flag. `--repo` exited 0 in samples 1 and 3, where only `leftover-temp` held, which `--repo` drops. It exited 1 in sample 2 for this repository's stale socket. `--leftovers` exited 0 |
| 6. At most 2.5 s wall and 0.3 s CPU | Wall mostly; CPU no | 15 runs at load 12 to 40 with 515 to 644 processes and 6 to 18 daemons: CPU 0.35 to 0.71 s (P3) |

D10's first run on a Mac is still owed: this host is Linux only.

## Setup

| Item | Value |
| --- | --- |
| Command | `node /home/agent/.claude/plugins/cache/hearsay/squeal/0.1.242/dist/cli/squeal.mjs ps …`, version 0.1.242, sha256 `937cbbc713d23370…`. This is the user-scope install that `claude plugin list` and `installed_plugins.json` name, with `gitCommitSha` 423953305 (tag `squeal--v0.1.242`). The project-scope entry of this repository moved from 0.1.240 to 0.1.242 at 18:59:55 UTC. Each sample resolved the install again; all three samples and both share windows ran this bundle. 0.1.244 had not reached the plugin by 19:27 UTC. It ran only as one e2e scratch daemon of another coordinator. The source of `src/core/ps/` and `src/cli/ps.ts` has not changed since the tag. |
| Host | Linux 6.8.0-147, 24 CPUs, Node v24.21.0, 47 GiB, 4 GiB swap. The load is other coordinators' work. Cezar restarted at about 19:09 UTC, between samples 1 and 2. That restart took the host from 16 daemons to 5 and from load 33 to 12; by sample 3 the host was back at 16 daemons and load 36. |
| Independent reads | `reader.py`: a Python reader of `/proc/*/stat`, `status`, `cmdline` and the `SQUEAL_DAEMON_CHILD` value of `environ` only. It takes two readings 2 s apart and runs concurrently with `ps --json` and `top -b -d 2 -n 2`. `flagcheck.py`: the D7 rules again, from `stat`, `/proc/locks`, `ss -xlp`, `installed_plugins.json`, the Codex cache, and the stores opened `mode=ro`. It runs within 3 s of each snapshot. `share.py`: the goal 3 windows. `ps -eo` before and after each sample. |
| Each sample | `ps --json` (with the reader and `top`), `ps --leftovers`, the by-hand flag check, then `ps`, `ps --full` and `ps --repo` one after another from this worktree, then five timed `ps` runs (`/usr/bin/time`) and three timed `--version` runs. The load, the CPU pressure and the process count go beside each run. |
| Rules kept | No end command was run, no signal was sent, and no daemon socket was opened. `strace` traced only my own `ps` run. My files went under `/tmp/dogfood-014-15/`, not under `HOME`, except this file. Verification through `squeal status` or `squeal run` was not used, because each connects to this worktree's daemon. |
| Raw data | `/tmp/dogfood-014-15/` (`s1`, `s2`, `s3`, `share-{1,2}.json`, `prof/`, `strace-ps-json.txt`, `sqlite-exp/`, `bin/`). It is not committed; this file keeps the numbers. |

## Samples

| Sample | UTC | Load 1/5/15 min | CPU pressure | Processes | Daemons, `ps` / `/proc` | Test processes, `ps` / marked heads in `/proc` |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 19:01:36 | 31.2 34.8 38.6 | 30% | 628 | 16 / 16 | 19 / 18 |
| 2 | 19:11:40 | 14.1 26.2 33.8 | 7% | 527 | 5 / 5 | 11 / 8 |
| 3 | 19:21:41 | 36.3 39.1 37.3 | 34% | 565 | 16 / 15 | 17 / 15 |

The test processes `ps` lists beyond the reader's are processes that left before the reader's second reading, 118 to 147 ms later. In samples 1 and 3, `ps` and the reader listed the same 3 escaped processes: an `agent-browser` and two `chrome_crashpad_handler` of a slow tier in the cezar repository, reparented to `systemd --user`. `ps` ties them to their daemon by token, as D5 says.

## Comparison with ps, top and /proc

Each daemon's values against the reader and against `top`'s second frame, in the same 2 s (the largest difference of each sample):

| Sample | Daemons compared | CPU %, against `/proc` | CPU time | Private memory | Swap | CPU %, against `top` | Private against `top` RES − SHR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 16 | 5.0 points | 100 ms | 0.6 MiB (16 within 1 MiB) | 0 | 13.5 points | 31 MiB |
| 2 | 5 | 5.5 points | 120 ms | 33.5 MiB (4 within 1 MiB; a 25 s old daemon still growing) | 0 | 5.5 points | 22 MiB |
| 3 | 15 | 6.4 points | 170 ms | 0.2 MiB (15 within 1 MiB) | 0 | 0.7 points | 43 MiB |

The CPU differences are the offset of the two windows: research measured a p90 of 17 to 18 points between 2 s windows. `top`'s RES − SHR is `RssAnon` and leaves out `RssShmem`, so it differs by tens of MiB from both readers. Start times, nice, lane, version and harness matched for every daemon and test process.

Sample 3 in full (CPU % `ps` / `/proc` / `top`; CPU time s; private MiB `ps` / `/proc` / `top` RES − SHR; swap MiB; test processes `ps` / `/proc`):

| PID | Worktree | Version | State | CPU % | CPU time | Private | Swap | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 640762 | 1c2b8b3b | 0.1.242 claude | serving | 34 / 39 / 34 | 38.7 / 38.6 / 38.7 | 820 / 820 / 820 | 0 / 0 | 3 / 2 |
| 405131 | e6b975d5 | 0.1.242 codex | serving | 33 / 27 / 33 | 124.2 / 124.1 / 124.2 | 728 / 728 / 728 | 0 / 0 | 2 / 2 |
| 486513 | 506469a8 | 0.1.242 claude | draining 60m left | 33 / 33 / 33 | 96.9 / 96.9 / 96.9 | 1301 / 1301 / 1258 | 0 / 0 | 1 / 1 |
| 310753 | 9fcc5087 | 0.1.242 claude | serving | 25 / 25 / 25 | 194.5 / 194.5 / 194.5 | 1122 / 1122 / 1155 | 0 / 0 | 4 / 3 |
| 492435 | c12ea906 | 0.1.242 codex | serving | 16 / 16 / 16 | 45.5 / 45.5 / 45.5 | 597 / 597 / 597 | 0 / 0 | 4 / 1 + 3 escaped |
| 329775 | f67bcfc3 | 0.1.242 claude | serving | 4 / 7 / 4 | 154.1 / 154.1 / 154.1 | 1221 / 1221 / 1258 | 0 / 0 | 1 / 1 |
| 318700 | 03442a37 | 0.1.242 claude | serving | 3 / 2 / 2 | 125.5 / 125.5 / 125.5 | 1285 / 1285 / 1258 | 0 / 0 | 1 / 1 |
| 674280 | 8157cb27 | 0.1.244, no harness | serving | 2 / 1 / 2 | 1.4 / 1.4 / 1.4 | 134 / 134 / 134 | 0 / 0 | 1 / 1 |
| 276108 | cb11ef0a | 0.1.242 claude | serving | 0 / 0 / 0 | 26.5 / 26.5 / 26.5 | 495 / 495 / 495 | 0 / 0 | 0 / 0 |
| 276229 | 1e955978 | 0.1.242 claude | serving | 0 / 0 / 0 | 13.5 / 13.5 / 13.5 | 215 / 215 / 215 | 0 / 0 | 0 / 0 |
| 338594 | 15c0d83e | 0.1.242 claude | serving | 0 / 0 / 0 | 27.8 / 27.8 / 27.8 | 460 / 460 / 460 | 0 / 0 | 0 / 0 |
| 615321 | f0f935ca | 0.1.242 claude | serving | 0 / 0 / 0 | 7.3 / 7.3 / 7.3 | 224 / 224 / 224 | 0 / 0 | 0 / 0 |
| 670541 | a6b4acd9 | 0.1.242 claude | serving | ? / gone / gone | 5.3 / gone / gone | ? / gone / gone | ? | 0 / 0 |
| 313448 | e7d66589 | 0.1.242 codex | serving | 0 / 0 / 0 | 68.3 / 68.3 / 68.3 | 740 / 740 / 740 | 0 / 0 | 0 / 0 |
| 340671 | b7555ac0 | 0.1.242 claude | draining 60m left | 0 / 0 / 0 | 79.3 / 79.3 / 79.3 | 520 / 520 / 520 | 0 / 0 | 0 / 0 |
| 643918 | f6dd5e87 | 0.1.242 codex | serving | 0 / 0 / 0 | 29.5 / 29.5 / 29.5 | 809 / 809 / 809 | 0 / 0 | 0 / 0 |

Daemon 670541, the main checkout's daemon, was in `ps`'s first reading only, so its window values are `?` and `unknown` names them, as D8 says. The reader never saw it.

Host totals and Squeal's totals, `ps --json` against `/proc` over the same 2 s:

| Value | Sample 1 | Sample 2 | Sample 3 |
| --- | --- | --- | --- |
| Load | 31.24 34.75 38.57, equal | 14.09 26.17 33.75 / 13.29 25.80 33.59 (read 2 s later) | 36.27 39.05 37.34 / 37.53 39.27 37.41 |
| CPU pressure `some avg10` | 30.1 / 28.4 | 6.7 / 5.9 | 33.6 / 35.3 |
| Memory pressure `some`, `full` | 0, 0 / 0, 0 | 0, 0 / 0, 0 | 1.14, 0.97 / 0.93, 0.79 |
| Memory used | 26.46 of 47.04 / 26.76 of 46.94 GiB | 13.36 / 12.98 of 46.94 GiB | 24.88 / 24.79 of 46.94 GiB |
| Swap used | 3.77 / 3.77 GiB | 2.65 / 2.65 GiB | 2.67 / 2.67 GiB |
| Busy CPU | 82.3 / 82.0% | 40.3 / 42.6% | 91.3 / 91.8% |
| Squeal CPU | 6.59 / 6.68 CPUs | 4.33 / 5.26 CPUs | 4.81 / 4.85 CPUs |
| Squeal CPU share | 33.9 / 33.9% | 45.2 / 51.5% | 22.2 / 22.0% |
| Squeal private memory | 13.50 / 13.49 GiB | 4.25 / 4.59 GiB | 12.78 / 12.85 GiB |
| Squeal memory share | 51.0 / 50.4% | 31.8 / 35.4% | 51.4 / 51.8% |
| Squeal swap | 0.32 / 0.32 GiB | 0 / 0 | 0 / 0 |
| Pool | 8 of 12, by hand 7 + `slow.lock` | 11 of 12, by hand 11 | 11 of 12, by hand 10 + `slow.lock` |

`MemTotal` changed between the two reads in sample 1 (47.04 and 46.94 GiB), as research saw. In sample 2 the Squeal totals differ by exactly the processes `ps` read as unknown. Fork worker 309746 used 91% of a CPU by the reader and was in one `ps` reading only; fork worker 309753 held 315 MiB by the reader and read `?` in `ps`. 4.33 + 0.91 = 5.24 CPUs and 4.25 + 0.31 = 4.56 GiB. `sumCosts` skips an unknown value, and the Squeal line prints the sum without saying it is a lower bound (P4).

## Goal 3: Squeal's CPU share

Two 60 s windows, each with three `ps --json` runs inside it (`share.py`). The tree count is each daemon's `utime + stime + cutime + cstime` at both ends, plus its descendants' growth, minus the CPU before the window of the descendants that exited inside it. Children reaped inside the window count through their parent. It leaves out the daemons that started or exited during the window (2 to 3 of 15), and the CPU of reaped escaped processes. `/proc/stat`'s nice field counts the user time of processes at nice above 0. Test processes run at nice 10 and daemons at 0. The only niced processes outside the daemons' trees were the tests' escaped browsers and two kernel threads (`khugepaged` 19, `ksmd` 5).

| Window (UTC) | Load | Host busy | Nice (user time) | Daemon trees | Processes alive at both ends only | `ps` runs inside the window |
| --- | --- | --- | --- | --- | --- | --- |
| 19:23:09 to 19:24:09 | 29.1 to 37.4 | 21.08 CPUs | 9.16 CPUs, 43% | 12.46 CPUs, 59%; 12 daemons at both ends, 42 descendants exited | 1.24 CPUs | 2.59, 7.53, 5.88 CPUs: 12.5%, 39.7%, 31.4% of busy (14, 14, 12 daemons) |
| 19:24:53 to 19:25:53 | 39.7 to 40.1 | 20.64 CPUs | 6.73 CPUs, 33% | 10.08 CPUs, 49%; 13 daemons, 33 exited | 1.56 CPUs | 6.59, 6.30, 3.28 CPUs: 28.4%, 27.4%, 21.8% (16, 14, 13 daemons) |

Goal 3's CPU share does not hold. `ps` reported 0.43 and 0.53 of the trees' CPU on average, with single runs from 0.21 to 0.65. The nice field agrees with the trees: the tests' user time, 6.7 and 9.2 CPUs, alone exceeds every `ps` reading in its window. Processes that lived through a whole minute used only 1.2 to 1.6 CPUs. Most of Squeal's CPU is in fork workers and their children that live seconds, and the 2 s window counts a process only when both readings see it. This agrees with the coordinator's host-load review: about 17.5 of 25 busy cores from Squeal's tests in a 20 s process-tree sample. The memory share holds, because resident memory is a state, not a rate.

## Goal 6: the cost of one snapshot

Five timed `squeal ps` runs per sample, one after another, with the load before each:

| Sample | UTC | Load 1 min | CPU pressure | Processes | Daemons | Test processes | Wall s | CPU s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 19:01:47 | 33.0 | 30% | 644 | 17 | 19 | 2.58 | 0.71 |
| 1 | 19:01:49 | 33.0 | 32% | 640 | 17 | 17 | 2.59 | 0.67 |
| 1 | 19:01:52 | 35.4 | 33% | 639 | 17 | 16 | 2.47 | 0.60 |
| 1 | 19:01:55 | 35.4 | 37% | 641 | 17 | 16 | 2.48 | 0.63 |
| 1 | 19:01:57 | 35.6 | 36% | 631 | 18 | 16 | 2.48 | 0.66 |
| 2 | 19:11:49 | 12.8 | 4% | 525 | 6 | 8 | 2.25 | 0.35 |
| 2 | 19:11:52 | 12.1 | 3% | 515 | 6 | 8 | 2.26 | 0.36 |
| 2 | 19:11:54 | 12.1 | 3% | 515 | 6 | 6 | 2.26 | 0.37 |
| 2 | 19:11:56 | 12.1 | 2% | 519 | 6 | 6 | 2.27 | 0.38 |
| 2 | 19:11:59 | 12.1 | 2% | 536 | 8 | 2 | 2.27 | 0.39 |
| 3 | 19:21:52 | 38.8 | 36% | 626 | 15 | 18 | 2.29 | 0.47 |
| 3 | 19:21:54 | 39.8 | 36% | 558 | 15 | 17 | 2.38 | 0.58 |
| 3 | 19:21:56 | 39.8 | 34% | 554 | 15 | 17 | 2.31 | 0.50 |
| 3 | 19:21:59 | 39.3 | 30% | 556 | 15 | 17 | 2.38 | 0.56 |
| 3 | 19:22:01 | 39.3 | 25% | 564 | 14 | 17 | 2.46 | 0.60 |

The CPU is user plus system time from `/usr/bin/time`; the maximum RSS was 91 to 95 MiB. Node start-up of the same bundle (`squeal --version`) took 0.10 to 0.17 s wall and 0.11 to 0.16 s CPU. `squeal ps --leftovers`, which skips the 2 s wait, took 0.56 to 0.69 s wall and 0.56 to 0.63 s CPU at load 40. Goal 6 names a host with 650 processes and 25 daemons; this host had at most 644 processes and 18 daemons, so the cost there is higher.

Where the CPU goes: one run under `node --cpu-prof` at 19:06 UTC, load 39.7, 17 daemons. That run used 0.84 s of CPU, with the profiler's overhead.

| Part | CPU ms |
| --- | --- |
| Bundle load and compile (2.4 MB) | about 80, beside Node's own start |
| `readWindow`: two `/proc` samples (40), discovery (44), attribution and marks (31), the stores twice (134, of which 96 in `.all()`) | 263 |
| `leftoverTemp` | 175, of which the size walk is 125 |
| `render`, of which `toLocaleString`'s first call is 19 | 22 |

Two parts cost CPU and give little:

- The size walk stops at 10,000 entries and then reports the size as unknown. It did so in all three samples (`unknown`: `files leftover-temp bytes`), so its 125 ms bought nothing.
- The open-runs query (`work.ts`, `OPEN_RUNS`) has no index on `worktree_id` and `end_state`: its plan is `SCAN runs` with a temp B-tree. It runs once per daemon per reading. Measured read-only with Python's `sqlite3`, one run took 3.18 ms on cezar's store (6,571 runs), and cezar had 9 daemons, read twice. It took 0.16 ms on this repository's store (1,145 runs).

## Flags

Each flag and information state that `ps` printed, judged against the host: within 3 s of the snapshot in samples 2 and 3, about 2 min after it in sample 1, and about 2 min after it for the open files and bound sockets of sample 2's leftovers. "s0" is the traced run at 18:58 UTC, before sample 1.

| Flag or state | Where | Judged | Evidence |
| --- | --- | --- | --- |
| `leftover-temp`, key directories | s1: 9 of 33 paths (the `--leftovers` run, 9 s after the `--json` run that counted 32); s2: 19 of 43; s3: 26 of 50 | True | Each is `/tmp/squeal-1001/tmp/<key>`. No live daemon's key (`sha256(repository id \0 root)[:16]`, recomputed) names it, it is older than 1 h by mtime, and no working directory, argument, open file or bound socket lies under it (checked in s2). The by-hand set equalled `--leftovers` in s2 and s3 |
| `leftover-temp`, two `/tmp/squeal-3000379296*` directories | s1 to s3 | True | Empty, 2026-10-16; the shared and fallback names of a fake uid, left by a Squeal test |
| `leftover-temp`, 22 other `/tmp/squeal-*` directories | s1 to s3, the same 22 each time (`comm` of the three lists) | False | They are not Squeal's leftovers. 20 are agents' review and probe directories (`squeal-review-014-13`, `squeal-review-014-13-r2`, `squeal-001-428-1001`, `squeal-issue6-*`, `squeal-011-42`, …), 2026-10-14 to 21, holding logs and drafts. `squeal-evals-1001` is the evals root (`evals/lib/root.mjs:16`, 1.4 GiB of cells and judge data). `squeal-e2e-cache` is the e2e dependency cache (`test/e2e/install.ts:55`, 176 MiB). D7's rule takes every `/tmp/squeal-*` directory (P1). With them inside, the size walk always passes 10,000 entries |
| `stale-socket` `/run/user/1001/squeal-1c2b8b3b5fd7edbe.sock` | s2, also under `--repo` | True | No process in `/proc` was a daemon of that id. `/proc/locks` had no holder of its lock file (inode 7618627), and `ss -xlp` showed no listener. Its daemon 3958516 (0.1.238) of sample 1 had exited between 19:01 and 19:11, the window of the cezar restart. By sample 3 a new daemon (640762) of that worktree served it, and `ps` no longer flagged it |
| `stale-socket` `…/squeal-fd5a859b8ca77ef9.sock`, changed 2026-10-16 | s0 | True | No daemon of that id; the same file research named. Someone removed it between 18:58 and 19:01 |
| `stale-pool-mark` `pool.mark.22c5f7538967e167` | s2 | True | 191 s old at the check, past 30 s. In sample 3 the same mark was 7 s old, rewritten by a live waiter, and `ps` did not flag it |
| `stale-pool-mark` `pool.mark.ad526a8130061fbb`, 2026-10-16 | s0 | True | Unchanged for 5 days |
| `orphan-test-process` pid 4182719 `MainThread`, up 0 s, token `7961727a-…` | s1, the `--full` run at 19:01:41 | False alarm, transient | By the rule's inputs true: no daemon ancestor, and a token no live daemon carries. It was gone at the next host-wide snapshot 6 s later; no read by hand caught it. Real tokens are UUIDs, and so are the tokens that `test/daemon/escaped-overlap.test.ts:363` draws with `randomUUID()`. So it was probably a test's own marked child, under a Vitest that no daemon runs, such as a reviewer's `npx vitest run` (inferred) (P8) |
| `older (session N holds it)` | s1: 6 daemons, 0.1.235, 0.1.238 and 0.1.240 | True | Each version is older than 0.1.242, the newest of both Claude Code scopes. Each consumer's harness process was alive at the check (6 of 6) |
| `draining Nm left` | s1: 3 daemons | Consistent, not confirmed | No consumer; their own departure was 1, 15 and 16 min ago, after their start. Their slow work could not be confirmed: the daemons had exited in the restart before the stores were read |
| `draining 60m left` | s3: 486513, 340671 | True | No consumer; departed 1 and 0 min ago, after the start; `slow-tier` reads `{"kind":"waiting","for":"fast"}` and `{"kind":"waiting","for":"slot"}` |

The flags `ps` did not print were absent by hand too. The check ran within 3 s of the snapshot in samples 2 and 3; in sample 1 it ran 2 min late, and its differences were changes in those 2 minutes. In samples 2 and 3:

- every root and its `gitdir` existed, and every bundle directory existed;
- no root had two daemons, and no daemon was `waiting`;
- every heartbeat was at most 4.3 s old against a 5 s interval;
- every consumer's harness process was alive;
- the scratch e2e daemons (0.1.243 in s0, 0.1.244 in s3, no harness) were under 1 h old;
- no `waiter.mjs` ran, and every `pool.*.lock` and `slow*.lock` holder was a daemon;
- each test process older than 60 s was its daemon's own child. There were three in sample 3, the oldest 478 s, and `overdue-test-process` excludes a daemon's own child.

In sample 1 one socket file had no daemon by hand. Its daemon (4184626) started after the snapshot, and the `--repo` run 5 s later showed it `starting`. In sample 3 `ps` did not evaluate `orphan-test-process`, because daemon 670541's token was unread. `unknown` named it, as D7 says.

States `ps` does not show:

- **The e2e runtime directories.** `/tmp/sq-XXXXXX`, from `test/e2e/harness.ts:147`: 632 directories, 621 older than 1 h, 552 MiB, holding `home`, `stubs`, `squeal/` and 91 `squeal-<id>.sock` files. D7 covers only `squeal-*` names under `/tmp` (P1).
- **Directories deleted under live sockets.** At sample 2, `/proc/net/unix` held 16 bound sockets `/tmp/squeal-1001/tmp/<key>/cez-ci-*/ipc` whose directories no longer existed. Their listeners still ran, for example pid 2797115, a Cezar QA server up 6.4 days under pid 1. Who removed the directories is not known. Candidates are a daemon's own clean-up, or someone who ran the `--leftovers` end command between 18:58 and 19:01, when the leftover count fell from 3,856 to 32 (inferred). The use check reads only working directories and arguments (`usedPaths` in `flags-files.ts`), so it would list such a directory as unused (P5).

## No side effects

One `ps --json` run under `strace -f` at 18:58 UTC, load 27.9:

- It opened each of the 3 stores twice, the database `O_RDONLY`. It opened `store.sqlite-wal` and `store.sqlite-shm` with `O_RDWR|O_CREAT`, which is SQLite's reader protocol for a WAL store.
- No `unlink`, `rename`, `mkdir`, `rmdir`, `truncate`, `chmod`, `utimensat`, `connect` or signal call ran. The only `bind` was `ss`'s netlink socket. The only spawn was `ss -xle`.

The `O_CREAT` matters when the WAL files are missing. In `/tmp/dogfood-014-15/sqlite-exp/`, a WAL database closed cleanly (no `-wal`, no `-shm`) and then opened with `node:sqlite` `{ readOnly: true }` gained both files. They stayed after the close, and the database's mtime did not change. A live daemon keeps its store open, so its WAL files exist, and `ps` reads only the stores of discovered daemons. The case is a daemon that holds its lock before it opens its store, or a store whose last connection just closed. It was not seen live (P6).

## Other observations

- **The work text prints a predecessor's departure.** It shows `1 session; session left 20h ago` for a daemon 33 min old with a live consumer. In sample 1, 7 of the 10 departures shown predated their daemon's own start, and every one of those daemons had a consumer. The flag rules already ignore such a departure (`ownDeparture`); the text does not (P7).
- **`?` in the MEMORY column.** `readWindow` reads memory after it reads every store again and attributes the processes again. In the profiled run that was about 80 ms after the second `stat` read (inferred from the profile). A fork worker that exits in that gap reads `?`. So does a head whose short-lived child (a test's `git`) exited, even when the head's own value is known. Over the three `--json` snapshots that was 25 of 47 rows: 17 only through a descendant and 8 through the head itself. In the text views it was 7 of 18, 3 of 6 and 10 of 13 rows (P4).
- **Long state words.** `older (session 190971 holds it)` is wider than the state column, so the row continues on a second line (6 rows in sample 1). This is readable, and no row is proposed.
- **The main checkout's daemon is short-lived.** The daemon of `/home/agent/projects/squeal` (`a6b4acd9`) was 2 s old at s0 and left inside sample 3's window. Two sightings are not enough for a row. It is for 011 to watch.
- **`--repo`.** It kept this repository's stale socket and dropped `leftover-temp`, as D1 says.
- **The unflagged counts.** `--full` counted 1,652 lock files at 19:01. By hand at 19:11 there were 1,666 in the two repositories with daemons (cezar 571, squeal 1,095), and 11 surplus permits (23 `pool.<i>.lock` files, 12 slots).

## Proposed rows

The numbers continue after 014-20; the coordinator assigns the final ones.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| P1, 014-21 `leftover-temp` lists other tools' directories | The same 22 foreign `/tmp/squeal-*` directories in all three samples, including the evals root (1.4 GiB) and the e2e cache (176 MiB). The end command deletes them. The e2e runtime directories `/tmp/sq-*` (552 MiB) are not covered. Blocks `shipped`. D7 amendment: only the names Squeal makes: `squeal-<uid>-<key>-XXXXXX` (`daemon/scratch.ts`), `squeal-e2e-XXXXXX` and `squeal-e2e-oc-XXXXXX` (the e2e fixtures), `squeal-update-XXXXXX` (`cli/update.ts`). Never `squeal-e2e-cache` or `squeal-evals-<uid>`. The e2e runtime directory `/tmp/sq-XXXXXX` gets a name the rule covers, such as `squeal-e2e-rt-XXXXXX`, if the socket path limit it may be short for allows it; else D7 adds `sq-XXXXXX` holding `home` and `stubs` | A `flags-files.test.ts` case: `/tmp/squeal-review-x`, `/tmp/squeal-evals-<uid>` and `/tmp/squeal-e2e-cache`, old and unused, are not flagged; `/tmp/squeal-e2e-AbC123` and `/tmp/squeal-<uid>-<key>-AbC123` are. On this host `--leftovers` lists no directory that `test/`, `evals/` or an agent made by name |
| P2, 014-22 the CPU share counts only processes alive across the window | Goal 3: `ps` reported 0.43 and 0.53 of the daemon trees' CPU over two 60 s windows (5.3 against 12.5 and 5.4 against 10.1 CPUs). Count, over the window: each process's own ticks; the growth of `cutime + cstime` of the daemons and test processes, so children that exited are counted; a process born in the window from its birth; minus the first-reading ticks of descendants that left. A total that skips an unknown value says so (`at least`, or `+ N unknown`) | A unit case: a child that starts and exits inside the window counts in its daemon's CPU. On this host, three `ps` runs inside one minute average within 10 points of the tree count (`share.py` in this file's method), with the load |
| P3, 014-23 goal 6's CPU | 0.35 to 0.71 s in 15 of 15 runs. Fixes: skip the size walk when it cannot finish (or run it only with `--full`), since it returned unknown in every sample for 125 ms; one `OPEN_RUNS` query per store and reading, filtered in memory, instead of one full scan per daemon; number formatting without `Intl` (19 ms). Node start-up is 0.11 to 0.16 s; whether goal 6's 0.3 s includes it is the coordinator's or the human's decision | On this host 5 runs at ordinary load use at most 0.3 s CPU, or the spec states goal 6 beyond start-up and that holds; the load and the counts beside each |
| P4, 014-24 a gone descendant makes its head `?` | 17 of 47 rows read `?` only because a descendant left. Read `status` right after the second `stat` read. A descendant gone at the second reading holds no memory, so it adds 0; `--full`'s `unknown` names it. This amends D5's rule from 014-13r | A `processes.test.ts` case: a head with a live value and one descendant gone at the second reading prints its own memory, not `?`. Over three snapshots on this host, `?` rows are only heads that left |
| P5, 014-25 the leftover use check misses bound sockets and open files | 16 key directories with live bound sockets were gone at 19:11. The rule reads only working directories and arguments. Also count the paths of `/proc/net/unix` and the targets of each `/proc/<pid>/fd` as uses | A `flags-files.test.ts` case: an old key directory with a listening socket of a live process, which no cwd or argument names, is not flagged |
| P6, 014-26 a read-only store open can create the WAL files | Experiment: `{ readOnly: true }` on a WAL store with no `-wal` and `-shm` creates both. Goal 4 says `ps` writes no store. When `-wal` is missing, read through an open that creates nothing (for example `immutable=1`, which is safe while no writer has the file open), or report the store `unknown` | A test: `ps` over a WAL store whose `-wal` and `-shm` are absent leaves the directory listing unchanged |
| P7, 014-27 the work text prints a predecessor's departure | 7 of 10 departures in sample 1 predated their daemon's start, and those daemons had a consumer. Print `session left` only for `ownDeparture` | A `render.test.ts` case: a daemon with a consumer and a departure before its start prints no `session left` |
| P8, 014-28 `orphan-test-process` flags a test's transient child | One flag on a process up 0 s that was gone 6 s later (inferred: a test's own marked child). Require an age floor, for example 60 s on both readings, before the flag; a real orphan stays | A `flags.test.ts` case: a marked process 5 s old with no owner is named in `unknown`, not flagged; one 61 s old is flagged |

## For the next worker

- The scripts are in `/tmp/dogfood-014-15/bin/` while this host keeps `/tmp`: `sample.sh <n> <cwd>`, `reader.py`, `compare.py`, `flagcheck.py`, `share.py <bundle> <seconds> <out>`, `goal6.py`. They read only; `flagcheck.py` and `share.py` open stores `mode=ro`, which has the same WAL behaviour as P6. To re-run a row's done-when on this host, run `sample.sh` three times 10 minutes apart and `share.py` twice, with the load.
- The live host changes fast: the cezar restart at about 19:09 UTC changed the daemon count from 16 to 5 and back within 12 minutes. Run each check by hand within seconds of the snapshot it checks.
- Each flag judgement above names its sample; the raw outputs (`text.txt`, `text-full.txt`, `text-repo.txt`, `ps.json`, `flagcheck.txt`, `compare.txt`) are in `s1` to `s3`.

## Round 2 (014-30)

Task 014-30, 2026-10-21, 22:18 to 22:49 UTC. The released 0.1.248 run on this host during ordinary work, with the round 1 method: three samples 10 minutes apart, two 60 s share windows, five timed runs per sample, and every flag judged by hand within 4 s of its snapshot. In sample 1 the check crashed after 15 daemons; after a script fix it ran again 56 s late for the rest and for the files. Two checks are new: 30 paired runs that put an independent tree count around each `ps` run, and a read of every store's `-wal` and `-shm` before and after each sample. Inputs: the brief in `tasks/wave-4.md` (014-30 and its "Round 2 specifics"), `spec.md` D3 to D10 as amended for wave 4, and round 1 above.

### Verdict

Goal 3 holds now. Goal 4 holds, except one false flag whose end command kills a serving daemon (P9). The `leftover-temp` rule never ran, so P1 and P5 could not be judged live. Goal 6's CPU still fails.

- **Goal 3, the CPU share.** Over two 60 s windows, three `ps` runs averaged 0.94 and 1.02 of the daemons' process-tree CPU, 5.6 and 0.4 points under the tree share. In round 1 they averaged 0.43 and 0.53. In 20 paired runs, the CPU rate over `ps`'s 2 s window was 1.00 of the tree rate over a window that encloses it (median; 0.95 to 1.54). All 11 saved lower-bound runs named their cause in `unknown` (`squeal cpuPct`). The memory share was within 1.5 points of `/proc` in the 3 samples.
- **Goal 4, the flags.** No `-wal` or `-shm` was created in 4 checks, and `strace` showed no write, removal, connection or signal. Every flag but one was true. Daemon 3586980 served for 24 min, but in 2 of 32 saved snapshots it read `waiting` and was flagged `no-lock` with `ends it: kill 3586980`. One `/proc/locks` read misses a lock that is held, in 1.8% and 3.0% of reads (P9). `leftover-temp` was not evaluated in any of the 38 runs that judge the whole host. Two leaked fake daemons of an evals test have no readable repository, and D7 then stops the rule (P10). By hand, the rule would have withheld every candidate in 3 of 3 samples: 182 to 196 directories, 84.8 to 84.9 MiB, because of 8 unreadable processes of an SSH session.
- **Goal 6, the cost.** One snapshot used 0.38 to 0.51 s of CPU in 15 of 15 runs, against 0.3 s. Node start-up alone (`--version`) used 0.15 to 0.19 s. Wall time was 2.26 to 2.71 s. It was over 2.5 s in 4 of 15 runs, all in sample 1 at load 52 to 54. The load was 41 to 82, against 12 to 40 in round 1. None of these runs read the leftover rule's open files, so a run that evaluates the rule costs more.

In my reading the spec does not move to `shipped` yet. Goal 6 fails with numbers, and P9 prints a `kill` for a healthy daemon. Two new defects follow as proposed rows; none is fixed here.

| Goal or row | Holds? | Evidence |
| --- | --- | --- |
| 3. Squeal's CPU and memory share | Yes | Windows: 0.94 and 1.02 of the tree count; pairs: median 1.00 of the tree rate; memory share 53.2 / 51.7, 54.3 / 53.9, 57.5 / 56.1% (`ps` / `/proc`) |
| 4. Each D7 state flagged; changes nothing | Partly | No sidecar created, no write call; one false `no-lock` (P9); `leftover-temp` and `orphan-test-process` not evaluated in any run (P10) |
| 6. At most 2.5 s wall and 0.3 s CPU | Wall mostly; CPU no | 15 runs at load 41 to 82, 558 to 778 processes, 18 to 21 daemons: CPU 0.38 to 0.51 s |
| P1, 014-22 Squeal's names only | Not judged live | The rule never ran. By hand, its names take 273 key directories and 5 `squeal-e2e-*` directories. They exclude the 307 other `/tmp/squeal-*` entries, among them `squeal-evals-1001` and `squeal-e2e-cache`, and 2,359 to 2,369 `/tmp/sq-*` |
| P2, 014-21 the CPU share | Yes | Goal 3 above; the mean of each window's three runs was within 10 points of the tree count (5.6 and 0.4) |
| P3, 014-23 goal 6's CPU | No | Goal 6 above |
| P4, 014-24 `?` memory | Yes | 30 of 150 test-process rows in 7 `--json` snapshots read `?`. Every one was a head that ended in the window: 28 were in one `stat` reading only, and `ps` named the other 2 as ended before the memory read. No row was `?` because of a descendant (17 of 47 rows in round 1) |
| P5, 014-25 sockets and open files as uses | Not judged live | The rule never ran. By hand, no old candidate was in use by any read (160 to 172 bound unix names) |
| P6, 014-26 no WAL file created | Yes, on the WAL path | 12 to 15 stores, each with `-wal` and `-shm` before and after every sample. The `immutable=1` path never ran, because no store lacked its `-wal` |
| P7, 014-27 own departure only | Yes | `session left` was printed only for a daemon with no session and its own departure: 2, 4 and 3 daemons in the samples. 10 daemons with a predecessor's departure printed none, and so did 3250068 in sample 1, whose own departure a session still held |
| P8, 014-28 the orphan age floor | Not judged live | `orphan-test-process` was not evaluated in any run (P10) |

D10's first run on a Mac is still owed.

### Setup

| Item | Value |
| --- | --- |
| Command | `node /tmp/dogfood-014-30/bundle-0.1.248/plugins/claude-code/dist/cli/squeal.mjs ps …`, the output of `git archive squeal--v0.1.248 plugins/claude-code` (tag at bb3e3b540), sha256 `0e05c55a439f94bd…`. At 22:19 UTC both Claude Code scopes already read 0.1.248, and `diff -r` found this `dist` byte-identical to the installed `~/.claude/plugins/cache/hearsay/squeal/0.1.248/dist`. Every number below comes from the pinned copy. The source of `src/core/ps/` and `src/cli/ps.ts` has not changed since the tag |
| Host | Linux 6.8.0-147, 24 CPUs, Node v24.21.0, 47 GiB, 4 GiB swap, all of it used. Other coordinators' work held the load at 41 to 82 and the CPU pressure at 35 to 67% |
| Independent reads | The round 1 scripts, copied to `/tmp/dogfood-014-30/bin/` and changed in four ways. `reader.py` also reads the children's times. `flagcheck.py` applies D7 as amended for wave 4 (the names, the four use reads, the unreadable processes) and opens a store only when its `-wal` and `-shm` both exist. `share.py` records `skipped` and `unknown`. The new scripts are `sidecars.py` and `sidediff.py` (the sidecar listing), `pair.py` (the paired runs), `locks-exp.mjs` (the `/proc/locks` experiment), `judge.py` (P4, P7 and the leftover outcome per snapshot), and `prof.py` |
| Rules kept | No end command was run, no signal was sent, and no socket was opened. `strace` traced only my own `ps` run. My files went under `/tmp/dogfood-014-30/`, except this file. The `flagcheck.py` store reads opened only stores whose sidecars existed |
| Raw data | `/tmp/dogfood-014-30/`: `s0` (traced run), `s1` to `s3`, `share-{1,2}.{json,txt}`, `pairs.json`, `pairs-2.json`, `locks-exp/run{1,2}.json`, `prof/`, `bin/`, `drive.log`. It is not committed; this file keeps the numbers |

| Sample | UTC | Load 1/5/15 min | CPU pressure | Processes | Daemons, `ps` / `/proc` | Test processes, `ps` / marked heads in `/proc` |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 22:22:22 | 46.8 50.3 50.5 | 46% | 659 | 17 / 17 | 21 / 17 |
| 2 | 22:32:22 | 79.8 68.7 59.6 | 67% | 641 | 20 / 20 | 23 / 20 |
| 3 | 22:42:22 | 41.7 54.7 58.0 | 35% | 570 | 19 / 19 | 23 / 21 |

Each daemon's values matched the reader in the same 2 s. CPU time was within 90 ms, private memory within 1 MiB for 55 of 56 daemons (the other was 2.9 MiB), and swap was equal. A daemon with no test process read within 6.5 points of the reader's own CPU plus its children's growth. The test processes `ps` lists beyond the reader's are processes that left between the two second readings, 144 to 225 ms apart.

### Goal 3: Squeal's share

The round 1 tree count (`share.py`) over two 60 s windows, with three `ps --json` runs inside each:

| Window (UTC) | Load | Host busy | Nice (user time) | Daemon trees | `ps` runs inside the window | Mean of the runs |
| --- | --- | --- | --- | --- | --- | --- |
| 22:42:46 to 22:43:46 | 41.9 | 21.30 CPUs | 9.51 CPUs, 45% | 15.30 CPUs, 72%; 18 daemons at both ends, 46 descendants exited | at least 14.89, 14.91, at least 13.30 CPUs: 65.0%, 67.9%, 65.9% of busy | 14.37 CPUs, 0.94 of the trees; 66.3% against 71.8% |
| 22:44:07 to 22:45:07 | 49.9 | 22.37 CPUs | 10.80 CPUs, 48% | 16.80 CPUs, 75%; 18 daemons, 36 exited | at least 17.81, 16.38, 17.18 CPUs: 77.5%, 69.7%, 77.0% | 17.13 CPUs, 1.02 of the trees; 74.7% against 75.1% |

The processes that lived through a whole minute used only 3.0 and 2.4 CPUs. The count of processes that end inside the window, which round 1 found missing, is now in `ps`. Five of the six runs were marked `at least`, and `unknown` named the left-out processes each time.

Two of those runs read above the window's 60 s tree rate, by 1.0 and 0.4 CPUs. A 2 s sample can be above a 60 s mean, so the paired runs decide the lower bound. Each pair takes a tree count from before `node` starts to after it exits, 2.3 to 3.0 s around `ps`'s 2.0 s window. An enclosing window holds at least the CPU of the window inside it. 30 pairs, 22:45:47 to 22:47:34 UTC, at load 58 to 71:

- 20 pairs counted the escaped trees too. `ps`'s CPU rate was 0.95 to 1.54 of the tree rate: median 1.00, mean 1.06. The 12 pairs where my count has no known gap averaged 1.02.
- `ps`'s CPU-seconds exceeded the enclosing count in 3 of those 20 pairs, by 0.1, 0.5 and 4.5 CPU-seconds. The 4.5 came in a pair where 2 daemons started or ended; my count drops such a daemon's tree. The 0.5 came where my escaped-tree count was −6.8 CPU-seconds: an escaped tree ended under `systemd --user`, which my count cannot see. 0.1 CPU-seconds is 10 ticks.
- The first 10 pairs did not count escaped trees and did not record daemon changes. One of them read 32.6 against 19.4 CPU-seconds, and its cause was not resolved.

Memory, `ps --json` against the reader in the same 2 s: private memory 12.97 / 12.96, 15.29 / 15.29 and 14.28 / 14.33 GiB. The shares were 53.2 / 51.7, 54.3 / 53.9 and 57.5 / 56.1%. The share differences come from `MemAvailable` read at different moments: in sample 1, 24.40 against 25.10 GiB used. Swap was equal. The host values matched `/proc` read in the same 2 s.

### Goal 4: the flags and side effects

| Flag or state | Where | Judged | Evidence |
| --- | --- | --- | --- |
| `older` | s1: 2470877, 2796376; s2: these and 3250068; s3: 2796376 | True | Version 0.1.245, older than the 0.1.248 that Claude Code installs; no consumer |
| `older (session N holds it)` | s1: 10 daemons; s2: 6; s3: 5 | True | 0.1.245 or 0.1.247; each consumer's harness was alive and registered with that older version |
| `draining Nm left` | s1: 2; s2: 4; s3: 2 | True | No consumer, an own departure, slow work waiting or running; the minutes are 60 less the departure's age |
| `root-gone`, `install-gone`, `not-installed` on 1310860 and 1310869 | Every run | True | Root and bundle missing, root under `/tmp`, 60 to 86 min old. They are the evals test's fake daemons (P10) |
| `root-gone`, `install-gone` on fake daemons 1 s old (3771342, 3773206 and two more) | s1, timed runs 4 and 5 | True at the read, transient | Cells of an evals test (pin 63f403d6d) were being removed. The processes had left by sample 2 |
| `no-lock` on 3586980, `ends it: kill 3586980` | s3: `ps` at 22:42:29 and timed run 4 at 22:42:41 | False | 3586980 (14e074b8, 0.1.248 claude, 24 min) held its lock file's WRITE lock in the `/proc/locks` copy of sample 3, and read `serving` in the other 30 saved snapshots, including runs 2 s before and after (P9) |
| Socket `/tmp/squeal-1001/squeal-7e639bd37a6400af.sock` | s2, the `--full --json` run | Named in `unknown`, not flagged: right | It had a listener but no daemon of its id, and it was gone a few seconds later. D7 names such a socket and never flags it |

The flags `ps` did not print were absent by hand too, in samples 1 to 3: `stale-socket`, `stale-pool-mark` (every mark at most 10 s old), `duplicate`, `hung` (heartbeats at most 5.4 s old against 5 s), `foreign-permit` and `orphan-waiter`. Once, `dead-consumer` was true by hand and not in `ps`: in sample 3, the harness of daemon 469239 (the main checkout's) left within 3 s after the snapshot. That is under the two heartbeat intervals the flag needs. `orphan-test-process` was not evaluated (P10). The pool read 8, 4 and 5 permits; by hand that was 7, 3 and 4, plus the holder of `slow.lock`.

`leftover-temp` was not evaluated in any of the 38 runs that judge the whole host; the 3 `--repo` runs drop it. 19 runs show the reason directly: 7 `--json`, 6 `--json` in the share windows, 3 `--full` and 3 `--leftovers`. It was "the temp key of daemon 1310860 is unknown: its root or repository cannot be read". The other 19 runs listed the two fake daemons, at which D7 stops. `--leftovers` printed no line, wrote that reason to stderr and exited 0. The by-hand check of D7 as amended, within 4 s of each `--json` snapshot:

| Sample | Candidates by name, old | Unused by every read | Size | Bound unix names read | Unreadable processes still there |
| --- | --- | --- | --- | --- | --- |
| 1 | 231, 182 | 182 | 84.8 MiB, 2,780 entries | 160 | 8 |
| 2 | 232, 183 | 183 | 84.8 MiB, 2,780 entries | 168 | 8 |
| 3 | 245, 196 | 196 | 84.9 MiB, 2,862 entries | 172 | 8 |

The 8 processes were the same in each sample: 5 `sshd`, `sftp-server`, `gpg-agent` and `(sd-pam)`, all of uid 1001, each with `fd` unreadable (EACCES). So with the fake daemons gone, `ps` would have withheld every candidate into one `unknown` entry in 3 of 3 samples: 182 to 196 directories, about 85 MiB. This is inferred from the rule and the reads; `ps` never printed it. On this host an SSH session was open in every sample, so the rule lists nothing. The human weighs that cost (D7 names it).

Side effects:

- **Sidecars.** `sidecars.py` listed 12 to 15 stores before each sample, after its `ps` runs, and at its end: the stores each live process held open, plus the stores `ps` named. No `-wal` or `-shm` appeared in samples 0 to 3. The differences between the listings were tests' scratch stores that came and went, a database file a live daemon wrote, and once a test store's `-wal` that its own process removed. Every store `ps` read had both sidecars, so `ps` took the WAL reader path every time.
- **System calls.** One `ps --json` under `strace -f`, at 22:21:56 UTC and load 41. It opened each of the 2 stores twice: the database `O_RDONLY`, and `-wal` and `-shm` `O_RDWR|O_CREAT`, both present before and after (SQLite's WAL reader). No `unlink`, `rename`, `mkdir`, `rmdir`, `truncate`, `chmod`, `utimensat`, `connect` or signal call ran. The only `bind` was `ss`'s netlink socket, and the only spawn was `ss -xle`.

### Goal 6: the cost of one snapshot

Five timed `squeal ps` runs per sample, one after another, with the load before each:

| Sample | UTC | Load 1 min | CPU pressure | Processes | Daemons | Test processes | Wall s | CPU s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 22:22:36 | 53.1 | 60% | 743 | 18 | 19 | 2.60 | 0.49 |
| 1 | 22:22:38 | 53.1 | 60% | 746 | 19 | 17 | 2.61 | 0.47 |
| 1 | 22:22:41 | 52.0 | 58% | 742 | 18 | 22 | 2.71 | 0.51 |
| 1 | 22:22:44 | 52.0 | 65% | 749 | 20 | 22 | 2.51 | 0.46 |
| 1 | 22:22:46 | 53.6 | 68% | 778 | 20 | 22 | 2.39 | 0.48 |
| 2 | 22:32:35 | 81.8 | 65% | 654 | 21 | 22 | 2.31 | 0.43 |
| 2 | 22:32:37 | 81.8 | 65% | 620 | 21 | 23 | 2.34 | 0.45 |
| 2 | 22:32:40 | 78.1 | 62% | 615 | 20 | 23 | 2.38 | 0.41 |
| 2 | 22:32:42 | 78.1 | 56% | 619 | 20 | 26 | 2.34 | 0.48 |
| 2 | 22:32:44 | 76.0 | 56% | 635 | 20 | 26 | 2.34 | 0.44 |
| 3 | 22:42:34 | 43.9 | 39% | 564 | 18 | 17 | 2.26 | 0.39 |
| 3 | 22:42:36 | 42.4 | 37% | 558 | 18 | 17 | 2.29 | 0.42 |
| 3 | 22:42:39 | 42.4 | 37% | 570 | 18 | 18 | 2.28 | 0.38 |
| 3 | 22:42:41 | 41.1 | 36% | 558 | 18 | 18 | 2.31 | 0.39 |
| 3 | 22:42:43 | 41.1 | 38% | 598 | 18 | 23 | 2.34 | 0.43 |

The CPU is user plus system time from `/usr/bin/time`, and the maximum RSS was 84 to 89 MiB. At similar load, round 1's sample 3 (load 39 to 40) used 0.47 to 0.60 s, and this round's sample 3 (load 41 to 44) used 0.38 to 0.43 s: about 0.1 s less. At load 12, round 1 used 0.35 to 0.39 s. This host was never that quiet tonight, so whether 0.248 meets 0.3 s at that load is not measured. Node start-up of the same bundle (`--version`) used 0.15 to 0.19 s of CPU, over half of goal 6's 0.3 s.

One run under `node --cpu-prof` at 22:24 UTC, at load 71, with 768 processes and 18 daemons: 2.90 s wall and 0.69 s CPU. The busy samples split as follows. Module compile was 24%. The stores (`readWork`) were 16%, of which `.all()` was about half. The process table was 12%, discovery 9%, GC 3%, and render and the flags 3%. The other 31% were `/proc` reads outside those functions and module loading. Measured read-only with Python's `sqlite3`, `OPEN_RUNS` now runs once per store and reading, at 1.8 ms on this repository's store (1,448 runs) and 4.3 ms on cezar's (6,102). The pending count takes 0.4 ms per daemon. The leftover rule's use reads did not run here (P10); wave 4 measured its open-file reads at 32 to 43 ms CPU at load 28.

### Other observations

- **Fake daemons of the evals tests.** `test/evals/fake-cell.ts` writes a fake `squeal.mjs` for each cell's pinned plugin. Its `daemon` command runs `setInterval` forever, spawned detached, and the cell's stop sends SIGTERM to the pid in `.git/squeal/fake.pid`. Processes 1310860 and 1310869 started at 21:22:00 UTC from cells pinned to ed5423b04. They ran at nice 10, like Squeal's test processes, under `systemd --user`, and outlived their cell, whose key directory `/tmp/squeal-1001/tmp/664f3e2feab7361c` is gone. They were still there at 22:48, 86 min later. They match D2's command-line rule, so `ps` lists them as daemons of "repository unknown" and flags them, as it should. Because neither their key nor their token can be read, `leftover-temp` and `orphan-test-process` are not evaluated for the whole host while they live (P10).
- **The main checkout's daemon** (`a6b4acd9`) was again short-lived. In sample 3, daemon 469239 was 10 to 14 s old and left inside the `--repo` run's window, which then read its CPU and memory as `?`. Round 1 saw the same twice. It is for 011 to watch.
- **`unknown` grows long.** On this host, every snapshot named 11 to 14 values. The text prints only their count, so the reason `leftover-temp` did not run shows only with `--full`. No row is proposed.

### Proposed rows

The numbers continue after P8; the coordinator assigns the final ones.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| P9 `no-lock` and `waiting` come from one `/proc/locks` read that can miss a held lock | 3586980 served for 24 min and held its lock file's WRITE lock. In 2 of 32 saved snapshots it read `waiting` and was flagged `no-lock` with `ends it: kill 3586980`. It read `serving` 2 s before and after. Mechanism: `/proc/locks` held 270 to 340 lines, 18 to 22 KB, and each `read()` returns one page (4,039 to 4,083 bytes). So `readFileSync` takes about 5 reads, and SQLite's locks change between them. In two runs of `locks-exp.mjs` (22:44 and 22:48 UTC, load 41 and 56), 9 of 500 and 30 of 1,000 `readFileSync` reads missed a daemon's lock-file lock that was held before and after the loop (16 daemons; 7 different daemons were missed). `discover.ts` reads `/proc/locks` once per snapshot, and the phase and `no-lock` rest on that read. Unlike `hung` and `orphan-test-process`, `no-lock` needs no second sample. The same read decides `duplicate`'s waiter and the pool's `held`. `stale-socket` is guarded by `ss`'s listener check while `ss` is present | A `discover.test.ts` or `flags.test.ts` case: a source whose first `locks()` lacks a daemon's held lock and whose second has it gives `serving` and no flag. A daemon is `waiting` only when its lock is missing from both readings (D2 amendment). On this host, over 30 snapshots, no `no-lock` falls on a daemon that serves in the runs before and after |
| P10 the evals test's fake daemons outlive their cell, and while they live two host-wide rules do not run | 1310860 and 1310869, `squeal.mjs daemon <root>` from `test/evals/fake-cell.ts` (`FAKE_SQUEAL`), ran 86+ min after their cell was removed. In all 38 runs that judge the whole host they turned off `leftover-temp` and `orphan-test-process` (D7, as specified). The test's stop path SIGTERMs `.git/squeal/fake.pid`, and why it did not run for these two cells is not known. A run killed mid-test is likely (inferred). Owner: the evals tests (006), not 014. One decision is 014's: whether a daemon whose root is gone and whose repository cannot be read should still stop those two rules for the whole host (D7 now), or be skipped by them. Skipping lists its key directory too, if it has one | The fake daemon exits when its root is gone or its test process ends, for example by checking its root in its interval. A test case removes a cell mid-run and finds no fake daemon left. On this host, after a full suite, `squeal ps` lists no root under `squeal-evals-cell-*`. The D7 decision is written in `status.md` |

P3 (014-23) stays open: its done-when, five runs at ordinary load at most 0.3 s of CPU, did not hold at load 41 to 82. Node start-up alone is over half the bound at that load. Whether the bound or the design moves is the coordinator's or the human's decision.

### For the next worker

- The scripts are in `/tmp/dogfood-014-30/bin/` while this host keeps `/tmp`. `sample.sh <n> <cwd>` takes one sample with the pinned bundle. `drive.sh <epoch of sample 1> <cwd>` takes samples 2 and 3 and both share windows. `pair.py <bundle> <runs> <out>` runs the paired check, and `locks-exp.mjs <reads>` the `/proc/locks` check. `judge.py`, `goal6.py`, `sharesum.py` and `prof.py` make the tables. They only read, and `flagcheck.py` opens a store only when its `-wal` and `-shm` exist.
- Judge P1, P5 and P8 live once the fake daemons are gone. `squeal ps --full --json` then shows the withheld `leftover-temp` entry, or the flag, and `flagcheck.py` gives the by-hand set to compare.
- A 2 s `ps` sample is not bounded by a 60 s mean. Check a lower bound against a count that encloses the same run (`pair.py`), not against the share window.
