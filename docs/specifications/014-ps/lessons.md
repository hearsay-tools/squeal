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

## Round 3 (014-35)

Task 014-35, 2026-10-22, 01:06 to 01:31 UTC. The released 0.1.252, run as a user runs it: the plugin's `bin/squeal ps`, which runs `dist/cli/ps.mjs` (014-33). Round 2's method, cut to the brief: three samples 10 minutes apart, each flag judged by hand within 3 s of its snapshot, one traced run, and 20 timed runs, each started only when the one-minute load was at or below 24, the CPU count. The host had no natural case for P5 or P8, so two plants of my own gave them one; the coordinator approved both at 01:13 UTC. Goal 3 held in round 2 and is not judged again. Inputs: the brief in `tasks/wave-5.md` (014-35), `spec.md` goals 4 and 6 and D7 as amended for wave 5, `status.md`, and round 2 above.

### Verdict

Goal 4, goal 6, P1, P5 and P8 hold, on the host as I found it. Goal 6 is judged on fewer processes and daemons than it names.

- **Goal 6, the cost.** 20 runs at load 2.7 to 5.5, with 403 to 450 processes and 4 to 9 daemons: CPU 0.17 to 0.23 s, wall 2.12 to 2.16 s, against 0.3 s and 2.5 s. The median CPU was 0.18 s. The start through the launcher, to a usage error, used 0.05 to 0.07 s; `node -e 0` used 0.04 to 0.05 s. Goal 6 names 650 processes and 25 daemons; the host had 425 and 5.5 (medians). A two-point estimate from rounds 2 and 3 puts 650 processes and 25 daemons at 0.24 to 0.45 s. The range depends on how much of round 2's higher cost came from its load of 41 to 82. That scale is not measured.
- **Goal 4, the flags and side effects.** Every flag `ps` printed in 46 saved snapshots was true by hand. No `no-lock` and no `waiting` fell on a serving daemon. No `-wal` or `-shm` was created in 4 checks. The traced run made no write, removal, connection or signal call.
- **P1, Squeal's names only.** The rule ran in every run that judges the whole host. It withheld its set into one `unknown` entry each time, because 5 to 7 processes of SSH sessions cannot be read: 335 to 354 directories, all of names Squeal makes. My by-hand set was the same, except for 2 directories that passed the hour between the two reads. The 312 to 313 other `/tmp/squeal-*` names were never in it, among them `squeal-evals-1001` and `squeal-e2e-cache`. `--leftovers` printed no line.
- **P5, sockets and open files as uses.** Two planted key directories, 2 h old by mtime, one used only by a listening unix socket and one only by an open file, were never in the withheld set in 4 of 4 snapshots. An unused control directory was in it every time.
- **P8, the orphan age floor.** A planted `sleep` with a mark that no live daemon owns was named in `unknown` at 15 and 40 s and not flagged. At 75 s a new daemon, 2 s old and still `waiting`, had no token yet, and D7 then claims no orphan; `unknown` said so. At 110 s it was flagged `orphan-test-process`, with `ends it: kill 2199493`.

In my reading, every goal now holds as last judged (1, 2 and 5 in round 1, 3 in round 2, 4 and 6 here), and no blocker is open. Two limits are the coordinator's to weigh before `shipped`: goal 6 is not measured at 650 processes and 25 daemons, and on this host `leftover-temp` lists nothing while an SSH session is open (D7 names that cost). One new finding follows as a proposed row (P11, a coverage gap of the leftover names); it is not a blocker. D10's first run on a Mac is still owed.

| Goal or row | Holds? | Evidence |
| --- | --- | --- |
| 4. Each D7 state flagged; changes nothing | Yes | 46 snapshots, no `no-lock` among them (P9's done-when asks for 30); flags printed: `older` (true), `root-gone` and `install-gone` on an e2e daemon whose root was being removed (true at the read), `orphan-test-process` on the plant (true). No sidecar created; no write, `unlink`, `connect` or signal call |
| 6. At most 2.5 s wall and 0.3 s CPU, at load at or below 24 | Yes, at 403 to 450 processes and 4 to 9 daemons | 20 runs at load 2.7 to 5.5: CPU 0.17 to 0.23 s, wall 2.12 to 2.16 s. Not measured at 650 processes and 25 daemons; estimate 0.24 to 0.45 s |
| P1, 014-22 Squeal's names only | Yes, on the withheld set | 335 to 354 directories withheld, all of Squeal's names, equal to the by-hand set; 312 to 313 other `/tmp/squeal-*` names excluded; `--leftovers` printed nothing and exited 0 |
| P5, 014-25 sockets and open files as uses | Yes, planted | The socket directory and the open-file directory were never withheld; the control was, in 4 of 4 snapshots. By hand, the socket read and the fd read each found one use |
| P8, 014-28 the orphan age floor | Yes, planted | 15 s and 40 s: named in `unknown`, not flagged. 75 s: no claim, a new daemon's token unread. 110 s: flagged, `kill 2199493` |

### Setup

| Item | Value |
| --- | --- |
| Command | `/tmp/dogfood-014-35/bundle-0.1.252/plugins/claude-code/bin/squeal ps …`, from `git archive squeal--v0.1.252 plugins/claude-code` (tag at 0fdccf30a). The launcher runs `dist/cli/ps.mjs` (136 KB, sha256 `88810f231698858f…`) for `ps`. At 01:11:09 UTC, during sample 1, Claude Code installed 0.1.252 in both scopes; `diff -r` found the installed `dist` and `bin/squeal` byte-identical to the pinned copy. Every number below comes from the pinned copy. The source of `src/core/ps/` and the `ps` CLI has not changed since the tag |
| Host | Linux 6.8.0-147, 24 CPUs, Node v24.21.0, 47 GiB, 4 GiB swap (1.9 GiB used). Load 2.7 to 6.8 over the round, CPU pressure under 2%. Only 4 to 9 daemons ran: the coordinators' work was light at this hour |
| Independent reads | Round 2's scripts, copied to `/tmp/dogfood-014-35/bin/` and changed in four ways. `sample.sh` runs the launcher, takes a second `/proc/locks` copy 0.5 s after the first, and starts each timed run only at load at most 24. `flagcheck.py` records which use read found each old candidate (P5) and lists marked heads whose token no live daemon owns, with their age (P8). New: `daemons.py` (the daemon count from `/proc` by D2's command-line rule), `goal6.sh`, `plant5.py` and `plant.sh` (the plants), `plantcheck.py`, `allflags.py`, `slope.py` |
| Rules kept | No end command that `ps` printed was run. No signal went to any process, mine included: both plants ended by themselves. The driver's only `kill` call was `kill -0` on its own planter, an existence check that sends no signal. No socket was opened. `strace` traced only my own `ps` run. My files went under `/tmp/dogfood-014-35/`, except this file and the plants' own paths |
| Raw data | `/tmp/dogfood-014-35/`: `g6/` (goal 6 runs and start-ups), `s0` (traced run), `s1` to `s3`, `plant/` (records and snapshots), `prof/`, `probe/`, `bin/`, `drive.log`. It is not committed; this file keeps the numbers |

| Sample | UTC | Load 1/5/15 min | Processes | Daemons, `ps` / `/proc` | Test processes, `ps` / the reader's, by parent |
| --- | --- | --- | --- | --- | --- |
| 1 | 01:10:17 | 4.3 5.8 14.2 | 409 | 9 / 9 | 4 / 1 |
| 2 | 01:20:17 | 4.1 5.6 10.0 | 435 | 4 / 4 | 0 / 0 |
| 3 | 01:30:18 | 4.5 5.7 8.2 | 443 | 4 / 4 | 4 / 1 |

In samples 1 and 3, the 3 test processes beyond the reader's were escaped processes of cezar's slow tier: an `agent-browser` and two `chrome_crashpad_handler`, under `systemd --user`, each with a `slow:vitest` mark. The reader found them as marked heads with no daemon ancestor, and `ps` tied them to their daemon by token (373847, then 1923655). Each daemon's CPU time, private memory and swap equalled the reader's in the same 2 s (`compare.txt`).

### Goal 6: the cost of one snapshot

Each run is `/usr/bin/time` around `bin/squeal ps`, started only when the one-minute load was at or below 24. The daemon count is `/proc`'s by D2's rule, and `ps`'s own first line:

| Set | UTC | Load 1 min | CPU pressure | Processes | Daemons, /proc / ps | Test processes | Wall s | CPU s | Max RSS MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| g6 | 01:07:12 | 3.3 | 0% | 410 | 6 / 6 | 4 | 2.16 | 0.23 | 74 |
| g6 | 01:07:16 | 3.1 | 1% | 405 | 6 / 6 | 4 | 2.12 | 0.17 | 75 |
| g6 | 01:07:20 | 3.1 | 0% | 404 | 6 / 6 | 4 | 2.12 | 0.17 | 75 |
| g6 | 01:07:24 | 2.9 | 0% | 405 | 6 / 6 | 4 | 2.12 | 0.17 | 75 |
| g6 | 01:07:28 | 2.7 | 0% | 403 | 6 / 6 | 4 | 2.13 | 0.18 | 74 |
| s1 | 01:10:29 | 4.3 | 0% | 418 | 9 / 9 | 5 | 2.15 | 0.20 | 75 |
| s1 | 01:10:31 | 4.5 | 0% | 416 | 9 / 9 | 5 | 2.14 | 0.19 | 74 |
| s1 | 01:10:33 | 4.5 | 0% | 423 | 9 / 9 | 4 | 2.15 | 0.19 | 75 |
| s1 | 01:10:36 | 4.5 | 0% | 423 | 9 / 9 | 5 | 2.13 | 0.19 | 74 |
| s1 | 01:10:38 | 4.2 | 0% | 422 | 9 / 9 | 5 | 2.13 | 0.18 | 75 |
| s2 | 01:20:29 | 5.1 | 0% | 438 | 5 / 5 | 4 | 2.14 | 0.19 | 74 |
| s2 | 01:20:31 | 5.1 | 1% | 440 | 4 / 4 | 4 | 2.15 | 0.19 | 74 |
| s2 | 01:20:33 | 5.5 | 0% | 440 | 4 / 4 | 4 | 2.13 | 0.18 | 74 |
| s2 | 01:20:35 | 5.5 | 0% | 438 | 4 / 4 | 4 | 2.13 | 0.18 | 74 |
| s2 | 01:20:37 | 5.2 | 0% | 439 | 4 / 4 | 4 | 2.12 | 0.18 | 74 |
| s3 | 01:30:29 | 4.3 | 0% | 432 | 4 / 4 | 1 | 2.13 | 0.18 | 74 |
| s3 | 01:30:32 | 4.2 | 0% | 450 | 4 / 4 | 4 | 2.14 | 0.19 | 74 |
| s3 | 01:30:34 | 4.2 | 0% | 447 | 4 / 4 | 4 | 2.13 | 0.18 | 74 |
| s3 | 01:30:36 | 4.2 | 0% | 427 | 4 / 4 | 0 | 2.13 | 0.18 | 74 |
| s3 | 01:30:38 | 4.2 | 0% | 450 | 4 / 4 | 4 | 2.14 | 0.20 | 74 |

The CPU is user plus system time, Node's start and the launcher's `sh` included. The first run of the round used 0.23 s; the other 19 used 0.17 to 0.20 s. The start-up alone, at load 3 to 5:

| Command | CPU s, user plus system | What it is |
| --- | --- | --- |
| `node -e 0` | 0.04 to 0.05 (12 runs) | Node itself |
| `bin/squeal ps --bogus` | 0.05 to 0.07 (5 runs) | the launcher and `ps.mjs`, to the usage error (exit 2) |
| `bin/squeal --version` | 0.10 to 0.12 (12 runs) | the launcher and the whole `squeal.mjs` |

So `ps`'s own work was about 0.12 s of the 0.18 s median. One run under `node --cpu-prof` at 01:17 UTC, at load 3.8 with 403 processes and 4 daemons, took 2.16 s wall and 0.28 s CPU with the profiler. Its 174 ms of busy samples split as follows: the two readings (`readWindow`) 79 ms, of which the process table 22 ms, the stores (`readWork`) 17 ms and discovery 9 ms; the file flags 34 ms, of which the leftover rule 32 ms and its use reads 13 ms; module compile about 14 ms; render under 2 ms.

**Scale.** Goal 6 names 650 processes and 25 daemons; the host had 403 to 450 processes and 4 to 9 daemons, and no daemon was started to reach more (the coordinator's instruction). Round 2 ran at larger counts, at load 41 to 82. Each round's own work is its run's CPU less its own start-up: round 2 ran `node squeal.mjs ps`, whose start-up is `squeal.mjs --version`, and round 3 runs `ps.mjs`.

| Round | Runs | Load | Processes, median | Daemons, median | CPU median s | Start-up s | Own work, median s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 (0.1.248) | 15 | 41 to 82 | 620 | 19 | 0.440 | 0.173 | 0.273 |
| 3 (0.1.252) | 20 | 2.7 to 5.5 | 425 | 5.5 | 0.180 | 0.062 | 0.118 |

The two rounds differ by 13.5 daemons and 195 processes at once (medians), so two points cannot split the cost between them. Each slope below puts the whole difference on one count, an upper bound for that count:

| Reading | Own work, round 2 less round 3 | All on daemons | At 25 daemons | All on processes | At 650 processes |
| --- | --- | --- | --- | --- | --- |
| Raw | 0.155 s | 11.5 ms per daemon | 0.40 s | 79.7 ms per 100 processes | 0.36 s |
| Load-scaled | 0.054 s | 4.0 ms | 0.26 s | 27.8 ms | 0.24 s |
| Raw, leftover rule set aside | 0.187 s | 13.9 ms | 0.45 s | 96.1 ms | 0.40 s |
| Load-scaled, leftover rule set aside | 0.086 s | 6.4 ms | 0.30 s | 44.2 ms | 0.28 s |

"At 25 daemons" is round 3's median CPU, 0.18 s, plus the slope times 19.5 more daemons; "at 650 processes" is the same plus the slope times 225 more processes.

Two things confound these numbers. First, load: `squeal.mjs --version`, the same work in both rounds, used 0.173 s in round 2 and 0.109 s in round 3, 0.63 as much, so CPU time itself grows with load on this host. The load-scaled lines multiply round 2's own work by 0.63. Second, the leftover rule ran in every round 3 run and in no round 2 run (P10), so the last two lines set its 32 ms aside. The estimate at 650 processes and 25 daemons is 0.24 to 0.30 s when the load scaling holds, and 0.36 to 0.45 s when none of round 2's extra cost was load. Within round 3, the runs at 4, 6 and 9 daemons used the same 0.17 to 0.20 s, the first run aside; that range is too narrow to show a slope. Which end holds is not measured, so this round does not judge goal 6 at that scale.

### Goal 4: the flags and side effects

Flags in the 46 saved snapshots (12 JSON, 34 text), each judged by hand within 3 s of its sample:

| Flag or state | Where | Judged | Evidence |
| --- | --- | --- | --- |
| `older` on 373847 (cezar, 0.1.248, `draining Nm left`) | Every whole-host snapshot | True | 0.1.248, older than the 0.1.250, then 0.1.252, that Claude Code installs; no consumer, so no session holds it. Its state stayed `draining` (own departure 33 to 53 min before, slow work running or waiting) |
| `older (session N holds it)` | s1: 1923655; from s2 on: also 947517 and 2022397 | True | Each consumer's harness was alive and registered with that older version. 947517 and 2022397 (0.1.250) read plain `serving` in sample 1, while 0.1.250 was the newest installed; after the 01:11:09 install they read `older (session …)` |
| `root-gone`, `install-gone` on 2048696 (`/tmp/squeal-opencode-QSVXxV/proj`, 9 s old) | s1, the text run only | True at the read, transient | An OpenCode e2e test was removing its directories; the root and the bundle `/tmp/squeal-e2e-oc-SZU9ta/…` were missing. The two `--json` runs 3 and 6 s earlier had read it `serving`, with no flag |
| `orphan-test-process` on 2199493 | The plant at 110 s | True | P8 below |
| `waiting` on 2219036, `stopping` on 2218769 | The plant at 75 s | True, no flag | A handover 2 to 3 s old: the new daemon had no lock yet, under the 40 s of `no-lock` |

The flags `ps` did not print were absent by hand too, in samples 1 to 3: `no-lock`, `duplicate`, `hung` (heartbeats at most 4.7 s old against 5 s), `stale-socket` (4 sockets, each with its daemon), `stale-pool-mark` (one mark in samples 2 and 3, 2 and 6 s old), `foreign-permit`, `orphan-waiter` and `not-installed`. Once, `dead-consumer` was true by hand and not in `ps`: in sample 1 the consumer of e2e daemon 2048696 left within 3 s after the snapshot, under the two heartbeat intervals the flag needs. Round 2 saw the same. The pool read 1 permit each time: the holder of `slow.lock` (373847 in samples 1 and 2, 1923655 in sample 3), as by hand.

Side effects:

- **Sidecars.** `sidecars.py` listed 3 to 10 stores before each sample, after its `ps` runs, and at its end, and before and after the traced run. No `-wal` or `-shm` appeared. The differences were tests' scratch stores that came and went, and database files that live daemons wrote. Every store `ps` read had both sidecars, so it took the WAL reader path each time.
- **System calls.** One `ps --json` through the launcher under `strace -f`, at 01:11 UTC and load 3.5. It opened each of the 4 stores twice: the database `O_RDONLY`, and `-wal` and `-shm` `O_RDWR|O_CREAT`, all present before and after (SQLite's WAL reader). No `unlink`, `rename`, `mkdir`, `rmdir`, `truncate`, `chmod`, `utimensat`, `connect` or signal call ran. The writes went to stdout and to Node's own wake-up descriptors (8-byte eventfd and 1-byte pipe writes, and one 16-byte message after `ss` exited with SIGCHLD). The only `bind` was `ss`'s netlink socket, and the only spawns were `dirname` (the launcher), `node` and `ss -xle`.

### P1, P5 and P8 live

**P1.** `leftover-temp` ran in every snapshot that judges the whole host; `--repo` drops it. In each, one `unknown` entry withheld its set, because processes of SSH sessions cannot be read, each with `fd` unreadable (EACCES). In samples 1 and 2 and the plant they were 7: `sd-pam` 1061, `gpg-agent` 37581, `sshd` 98559, 2039559, 2039560 and 2039561, and `sftp-server` 2039563. In sample 3 a new login had replaced the last four with `sshd` 2272087 and `sftp-server` 2272101, so 5. `ps` named the same processes as my read each time. The by-hand check of D7, within 3 s:

| Snapshot | Withheld by `ps` | By hand: old, unused | Difference | Other `/tmp/squeal-*` names, never candidates | Size by hand |
| --- | --- | --- | --- | --- | --- |
| s1 `--json` | 335 | 335 | none | 313 | 303.9 MiB, 12,364 entries |
| s2 `--json` | 343 | 345 | 2 directories 3,598 and 3,599 s old at `ps`'s read, past the hour at mine | 312 | 415.2 MiB, 16,141 entries |
| s3 `--json` | 354 | 354 | none | 312 | 415.2 MiB, 16,189 entries |
| plant, 4 snapshots | 349 each | 349 each, of 351 old: the 2 in use were the plants | none | 312 to 313 | 415.2 MiB, 16,161 entries |

Every withheld path had a name D7 lists: a key directory under `/tmp/squeal-1001/tmp/`, or `/tmp/squeal-e2e-XXXXXX` and the like. `squeal-evals-1001`, `squeal-e2e-cache`, the agents' `squeal-review-*` and the 2,433 `/tmp/sq-*` entries were never in it. `--leftovers` printed no line in any sample, wrote the withheld reason to stderr and exited 0. With no SSH session the set would be listed and flagged; on this host a session was open in every sample, as in round 2.

**P5**, planted by `plant5.py` (pid 2199408) at 01:20:40 UTC: three directories under `/tmp/squeal-1001/tmp/`, names drawn at random and checked absent, each with its mtime set 2 h back. `d1786a8409beba74` held `s.sock`, bound and listening by the planter. `f44c24436cf4112e` held `f.txt`, open in the planter. `cbd56dedef3ff2c3` stayed empty, the control. No working directory or argument named them. The planter exited by its own deadline at 01:24:40 and removed the three directories by exact path.

| Snapshot (sleep age) | Socket directory | Open-file directory | Control | By hand: the read that found each use |
| --- | --- | --- | --- | --- |
| 01:20:56 (15 s) | not withheld | not withheld | withheld | socket 1, fd 1 |
| 01:21:21 (40 s) | not withheld | not withheld | withheld | socket 1, fd 1 |
| 01:21:56 (75 s) | not withheld | not withheld | withheld | socket 1, fd 1 |
| 01:22:31 (110 s) | not withheld | not withheld | withheld | socket 1, fd 1 |

No old candidate was in use on the host by any read in samples 1 to 3, so the plant is the only positive case of this round.

**P8**, planted by `plant.sh` at 01:20:40.9 UTC: `env SQUEAL_DAEMON_CHILD=25d685346aa6461f:vitest sleep 150`, pid 2199493, a child of my own shell and under no daemon. The token was drawn at random. It exited by itself at 01:23:10.9, after 150.0 s.

| Snapshot | Age at `ps`'s first reading | `ps --full --json` | Text | By hand |
| --- | --- | --- | --- | --- |
| 01:20:56 | 15 s | `unknown`: "process 2199493's mark names no live daemon, but it is 15 s old, under 60 s"; no orphan | no orphan row | the mark's token is none of the 4 daemons' tokens, all read; 18 s old |
| 01:21:21 | 40 s | `unknown`: "… 40 s old, under 60 s"; no orphan | no orphan row | the same; 43 s old |
| 01:21:56 | 75 s | `unknown`: "the token of daemon 2219036 is unread, so a mark may be its"; no orphan | no orphan row | 4 of 6 tokens read: 2219036 (`waiting`, 2 s) and 2218769 (`stopping`, 3 s) had none |
| 01:22:31 | 110 s | orphan 2199493, `orphan-test-process`: "its mark's token 25d685346aa6461f names no live daemon, on both samples", `kill 2199493` | `2 flags: older, orphan-test-process`; the row under "Processes no live daemon owns" with `ends it: kill 2199493` | none of the 4 tokens, all read; 113 s old |

No marked process lacked an owner on the host in samples 1 to 3. The coordinator told the other coordinators about both plants before they ran.

### Other observations

- **The plugin cache moved to 0.1.252 during sample 1**, at 01:11:09 UTC. The brief expected 0.1.250 at most. It made a live check of `older` possible: the two 0.1.250 daemons read `serving` before and `older (session N holds it)` after, both true.
- **`older` on a draining daemon.** 373847 read `draining 18m left` and was flagged `older`, whose end command `squeal stop <root>` would end the slow tier it drains. D7 gives both: `older` is a flag unless a session holds it, and `draining` is a state. No row is proposed; the human may weigh whether an older daemon that drains should read as information only.
- **Short-lived e2e daemons.** The e2e tests of another coordinator started and removed daemons in `/tmp` within seconds (0.1.253, from an e2e fixture's bundle). `ps` listed each with no harness, and once flagged one `root-gone` and `install-gone` while its directories were being removed. That is true at the read and transient, as round 2's fake daemons were.

### Proposed rows

The numbers continue after P10; the coordinator assigns the final ones.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| P11 `leftover-temp` misses the `/tmp` names of Squeal's own test helpers | D7 lists the names of `daemon/scratch.ts`, the e2e fixtures and `cli/update.ts`. Squeal's test helpers make other `/tmp/squeal-*-XXXXXX` names: `squeal-opencode-` (`test/helpers/opencode.ts:157`), `squeal-setup-`, `squeal-setup-home-` and the like (`test/cli/setup/fixture.ts`), and `squeal-pi-…-` (`test/harness/pi-fixture.test.ts`, `test/e2e/pi-update.test.ts`). On this host at 01:27 UTC, 11 such directories were older than 1 h: 6 `squeal-opencode-*` (about 137 MiB), 3 `squeal-setup-*` and 2 `squeal-pi-*` (about 6 MiB). They are left by test runs that were stopped before their cleanup (inferred). No rule names them, so no end command removes them. Not a blocker: the rule withholds everything on this host while an SSH session is open | Either the helpers name their directories with a prefix D7 lists, or D7 adds these prefixes. A `flags-files.test.ts` case flags an old, unused `squeal-opencode-AbC123`. On this host `flagcheck.py`'s list of other `/tmp/squeal-*` names holds no test helper's `mkdtemp` name |

### For the next worker

- The scripts are in `/tmp/dogfood-014-35/bin/` while this host keeps `/tmp`. `sample.sh <n> <cwd>` takes one sample with the pinned launcher, and `drive.sh <epoch of sample 1> <cwd>` takes samples 2 and 3 with the plants between. `goal6.sh <out> <runs> <cwd>` takes timed runs at load at most 24; `goal6.py <dir>...` and `slope.py <dir>...` make the goal 6 tables. `plant.sh` plants P5 and P8 for about 4 minutes, and `plantcheck.py <snapshot>` reads one plant snapshot. Plant again only with the coordinator's approval: other sessions' `squeal ps` show the orphan flag while it lives.
- Goal 6 at 650 processes and 25 daemons needs a host that busy at load at most 24. Tonight's host never had both: round 2 had the counts at load 41 to 82, and round 3 the load at 4 to 9 daemons.
- On this host an SSH session is always open, so `leftover-temp` is judged on the withheld `paths`, never on a listed flag.

## Round 4 (014-37)

Task 014-37, 2026-10-22, measurements from 07:25 to 07:33 UTC. Goal 6 at its named size, as the human chose on 2026-10-22: five timed runs of `squeal ps` as a user runs it, at 650 or more processes and 25 or more daemons, each started at a one-minute load at or below 24, judged against 0.3 s CPU and 2.5 s wall. The bundle is a pinned copy of the release `squeal--v0.1.256`. To reach the size, I started 25 idle daemons and 202 idle processes of my own, and removed them after the runs. Inputs: the brief in `tasks/wave-6.md` (014-37), `spec.md` goal 6 and D11, `status.md`, and Round 3 above.

### Verdict

Goal 6 fails at its named size, on CPU. Wall time holds.

- **Full size.** Five runs at 681 to 690 processes and 32 to 33 daemons, at load 15.8 to 17.1: CPU 0.28, 0.34, 0.32, 0.33 and 0.37 s, over 0.3 s in 4 of 5, median 0.33 s. Wall 2.19 to 2.23 s, under 2.5 s in all 5. One more run, at 615 processes, is not one of the five, because the host's own processes fell by about 70 in 4 s; it used 0.36 s.
- **The host as found.** Five runs before the setup, at 510 to 525 processes and 9 to 10 daemons, at load 12.3 to 14.1: CPU 0.21 to 0.26 s, median 0.22 s; wall 2.14 to 2.17 s.
- **Start-up is not the cause.** Right after the sixth run (0.37 s), the start-up through the launcher to a usage error used 0.06 s, the same as at the host as found. So `ps`'s own work in that run was about 0.31 s.
- **The parts.** One profiled run at full size had 272 ms of busy samples, against 174 ms in Round 3's at 403 processes and 4 daemons. The 97 ms more: the store reads +30 ms (27 stores, against 2), the leftover rule's use reads +21 ms (open files +17 ms of it), the marks +13 ms, the discovery +7 ms, and the locks and the leftover names +5 ms each.
- **Above the named size.** The brief's 25 daemons came on top of the host's own 7 to 8, so the runs had 32 to 33 daemons, not 25, and 681 to 690 processes, not 650. A line through the medians of the two measured sets puts the named size at 0.30 to 0.31 s, at the bound. That is an estimate, not a measurement, and the two sets differ in load too.

| Goal | Holds? | Evidence |
| --- | --- | --- |
| 6. At most 2.5 s wall and 0.3 s CPU, 650 processes and 25 daemons, at load at or below 24 | No, on CPU; wall holds | 5 runs at 681 to 690 processes and 32 to 33 daemons, load 15.8 to 17.1: CPU 0.28 to 0.37 s, over 0.3 s in 4, median 0.33 s; wall 2.19 to 2.23 s |

`ps` flagged none of my daemons: each of their 150 rows in the six runs read `serving`, with no harness and work `idle`. No new defect was found, so no row is proposed. The coordinator takes the miss to the human (the coordinator's instruction). Goals 1 to 5 stand as last judged.

### Setup

| Item | Value |
| --- | --- |
| Command | `/tmp/dogfood-014-37/bundle-0.1.256/plugins/claude-code/bin/squeal ps`, from `git archive squeal--v0.1.256 plugins/claude-code` (476c8e988), run in this worktree, a Squeal repository. The launcher runs `dist/cli/ps.mjs` (sha256 `f1163cbd775aa1ba…`). Between 0.1.252 and 0.1.256, `src/core/ps/`, `src/cli/ps.ts` and `src/cli/ps-index.ts` did not change; `ps.mjs` differs from Round 3's because 9 shared files under `src/core/store`, `src/core/fs` and `src/core/types` changed |
| Host | Linux 6.8.0-147, 24 CPUs, Node v24.21.0, 46 GiB. Another coordinator's wave ran: the one-minute load was 29 at 07:19 UTC (the coordinator's reading), 37.5 at 07:22, then 12 to 31. Its daemons ran fast tiers through the full-size runs, 6 to 12 test processes, with CPU pressure at 3 to 6% |
| Daemons | 25, each in its own throwaway git repository, `/tmp/dogfood-014-37/repos/r1` to `r25`. Each repository holds one commit of a `squeal.config.json` that sets `daemon.idleExitMinutes` to 85, so each daemon, with no consumer, ends by its own setting 85 minutes after its last activity. Started by `bin/squeal start <root>` from the pinned bundle, with `HOME` and `TMPDIR` under `/tmp/dogfood-014-37`. `XDG_RUNTIME_DIR` stayed the user's, so their sockets went to the host daemons' directory (`src/core/daemon/paths.ts`). Each was idle: no repository has Vitest, so each daemon noted that `vitest/node` does not resolve and listed no test files. Daemon r1 used 0.41 s of CPU to start, had no child process and an RSS of 124 MiB (`ps`: 48 MiB private) |
| Idle processes | 202, to bring the host to about 680: 57 `node -e "setTimeout(() => {}, …)"` and 145 `sleep`, each in its own session, each ending by itself 88 minutes after the first start. 28% of them are `node`, the host's share just before they started: 26 `node` of its 92 user processes, kernel threads (433) aside. Started in two parts: 130 at 07:30:54, and 72 at 07:31:47, after the host's own processes fell by about 90 |
| Marker | `DOGFOOD_014_37=<16 hex digits>` on every process I started: `git`, `squeal start`, the daemons and the idle processes. `mine.py` finds them in `/proc/<pid>/environ` |
| Timeline, UTC | 07:25:06 five runs at the host as found. 07:30:12 the first start, at load 18.9. 07:30:41 the 25th daemon. 07:30:59 to 07:31:16 five runs. 07:31:49 the sixth run. 07:31:54 the profiled run. 07:32:14 teardown. 07:32:39 all down, 2 min 27 s after the first start |
| Rules kept | Round 3's, with the brief's teardown. No end command that `ps` printed was run; at full size it printed none. The only signals went to my own 202 idle processes, a TERM at teardown; no KILL was needed. The only sockets opened were my CLI's to my own daemons: `squeal start` and `squeal stop` for each root, and one `squeal status --full` in r1. My files went under `/tmp/dogfood-014-37/` |
| Raw data | `/tmp/dogfood-014-37/`: `g6-found/`, `g6-full/` and `g6-full2/` (runs and start-ups), `prof/`, `bin/`, `start.*`, `stop.log`, and the lists of sockets and temp keys before and after. It is not committed |

### Goal 6: the cost of one snapshot

Each run is `/usr/bin/time` around `bin/squeal ps`, started only when the one-minute load was at or below 24. The process count is read just before the run; the daemon count is `/proc`'s by D2's rule, and `ps`'s own first line:

| Set | UTC | Load 1 min | CPU pressure | Processes | Daemons, /proc / ps | Test processes | Wall s | CPU s | Max RSS MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| as found | 07:25:06 | 14.1 | 3% | 511 | 10 / 10 | 5 | 2.14 | 0.22 | 78 |
| as found | 07:25:10 | 14.1 | 2% | 512 | 10 / 10 | 5 | 2.14 | 0.21 | 77 |
| as found | 07:25:14 | 13.4 | 1% | 510 | 9 / 9 | 4 | 2.14 | 0.21 | 78 |
| as found | 07:25:19 | 13.0 | 1% | 519 | 9 / 9 | 10 | 2.17 | 0.26 | 77 |
| as found | 07:25:23 | 12.3 | 1% | 525 | 10 / 10 | 9 | 2.16 | 0.24 | 78 |
| full | 07:30:59 | 17.0 | 4% | 681 | 32 / 32 | 6 | 2.19 | 0.28 | 78 |
| full | 07:31:03 | 16.8 | 3% | 685 | 32 / 32 | 7 | 2.22 | 0.34 | 77 |
| full | 07:31:07 | 17.1 | 3% | 690 | 32 / 32 | 10 | 2.20 | 0.32 | 77 |
| full | 07:31:12 | 16.2 | 4% | 687 | 32 / 32 | 6 | 2.23 | 0.33 | 78 |
| not full | 07:31:16 | 17.0 | 5% | 615 | 32 / 32 | 12 | 2.23 | 0.36 | 78 |
| full | 07:31:49 | 15.8 | 6% | 684 | 33 / 33 | 11 | 2.23 | 0.37 | 79 |

The CPU is user plus system time, Node's start and the launcher's `sh` included. Every run exited 0, except the last run at the host as found: it exited 1 on a true, transient flag (Other observations). The start-up was measured right after each set, 3 runs each:

| After | `node -e 0`, CPU s | `bin/squeal ps --bogus`, CPU s |
| --- | --- | --- |
| the host as found, 07:25:25 | 0.05, 0.06, 0.05 | 0.07, 0.06, 0.06 |
| the five full runs, 07:31:18 | 0.08, 0.07, 0.07 | 0.10, 0.08, 0.10 |
| the sixth run, 07:31:51 | 0.07, 0.06, 0.05 | 0.06, 0.06, 0.06 |

Each set's own work is its median CPU less its start-up, as in Round 3:

| Set | Runs | Load | Processes, median | Daemons, median | CPU median s | Start-up s | Own work, median s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Round 3 (0.1.252) | 20 | 2.7 to 5.5 | 425 | 5.5 | 0.180 | 0.062 | 0.118 |
| As found (0.1.256) | 5 | 12.3 to 14.1 | 512 | 10 | 0.22 | 0.06 | 0.16 |
| Full (0.1.256) | 5 | 15.8 to 17.1 | 685 | 32 | 0.33 | 0.06 to 0.10 | 0.23 to 0.27 |

The start-up rose to 0.08 to 0.10 s once, after the five full runs, and fell back to 0.06 s after the sixth. Load raises the CPU time on this host (Round 3, "Scale"), but here it does not explain the miss: the sixth run used 0.37 s with a start-up of 0.06 s.

**The named size, estimated.** From the host as found to full size, the median CPU rose 0.11 s over 22 more daemons and 173 more processes. Put all on the daemons, that is 5.0 ms per daemon, and 25 daemons give 0.30 s. Put all on the processes, it is 0.64 ms per process, and 650 processes give 0.31 s. Both lines also carry the load difference, 12 to 14 against 16 to 17. Goal 6 at exactly 650 processes and 25 daemons is not measured.

**The profiled run**, 07:31:54 UTC, at load 16.0, with 681 processes and 33 daemons in 27 repositories: `node --cpu-prof dist/cli/ps.mjs ps`, 2.21 s wall and 0.42 s CPU with the profiler. Busy samples by part, against Round 3's profiled run (403 processes, 4 daemons in 2 repositories, load 3.8):

| Part (function) | Round 4, ms | Round 3, ms |
| --- | --- | --- |
| All busy samples | 272 | 174 |
| The two readings (`readWindow`) | 138 | 79 |
| of which the stores (`readWork`) | 48 | 17 |
| of which the locks (`locks`) | 25 | 20 |
| of which the process table and host files (`takeSample`) | 25 | 22 |
| of which the marks (`attribute`, nearly all `markOf`) | 17 | 4 |
| of which the discovery (`discover`) | 17 | 9 |
| The file flags (`fileFlags`) | 64 | 34 |
| of which the leftover rule's use reads (`unusedPaths`) | 34 | 13 |
| of which its open-file reads (`fds`) | 26 | 9 |
| of which the leftover names (`names`) | 20 | 15 |
| Garbage collection | 11 | 8 |
| Module compile, self time | 9 | 14 |
| Render | 2 | 1 |

The parts that grew the most are those that scale with the stores, the processes and the open files:

- **Stores.** Each repository has one store, so 27 repositories gave 27 stores. My 25 are small: 0.6 MiB each (a 4 KiB database, a 564 KiB WAL). The host's two are large: 176 MiB (squeal) and 537 MiB (cezar), each with a 14 MiB WAL. `readOne` took about 15 ms for Round 3's 2 large stores, and about 40 ms here for 2 large and 25 small ones, so about 1 ms for each small store (rough, at a sampling interval of about 1 ms). A host with 25 real daemons has fewer stores, because a repository's worktrees share one, but larger ones.
- **Marks and open files.** `markOf` reads each candidate process's environment, and the use reads list each process's open files. My 82 `node` processes (25 daemons, 57 idle) and the other 145 grew both. A real host grows to 650 processes mostly by test processes, which are `node` too.
- **Leftover names.** `/tmp` held 38,706 entries just after the round; the leftover rule's listing took 20 ms, against 15 ms in Round 3.

### Teardown

`teardown.sh` ran `squeal stop <root>` for each of the 25 roots: each printed "Squeal daemon stopped" and exited 0. After that, 202 processes still carried the marker, all idle processes of mine; a TERM ended all of them within 10 s. Then it removed the repositories, `HOME`, `TMPDIR` and the bundle; the raw data stays.

At 07:33:03 UTC, from a shell whose command line did not name the directory, `/proc` held nothing of this round: `mine.py` found no process with the marker, `naming.py` found no process whose command line names `/tmp/dogfood-014-37`, and D2's rule counted 7 daemons, all the host's. The `squeal-*.sock` names in `/run/user/1001` were the 9 of before the setup; none of mine was left. Under `/tmp/squeal-1001/tmp`, 3 empty key directories were new, and 2 more had come and gone. None names my directory, and my daemons ran no tier, so they come from the other daemons' tiers (inferred).

### Other observations

- **No `not-installed`.** My daemons ran from a bundle outside any plugin cache, but lived 2 min 27 s at most. `ps` gave them no flag in any run.
- **An e2e daemon, flagged truly.** The last run at the host as found exited 1 with `root-gone` and `install-gone` on daemon 10539, version 0.1.900, 1 s old, whose root `/tmp/sq-vc-jFWzjb/repo` and bundle were missing: another coordinator's e2e fixture removing its directories. True at the read and transient, as Round 3 saw.
- **The process count moves fast.** The host's own processes fell by about 70 within 4 s, and by about 90 within 40 s, as other daemons' tiers ended. A count read before a run can be off by that much during it. The 72 idle processes added at 07:31:47 brought the count back above 650 for the sixth run.

### For the next worker

- The kit is in `/tmp/dogfood-014-37/bin/` while this host keeps `/tmp`. `setup.sh <daemons>` makes the repositories and starts the daemons; `fillers.sh <node> <sleep>` starts the idle processes; `teardown.sh` stops and removes everything; `mine.py` and `naming.py` show what is left in `/proc`. `goal6.sh <out> <runs> <cwd>` takes timed runs at load at most 24 and reads the load once a minute while it waits; `waitload.sh <max> <minutes>` waits for a load; `children.py <profile> <function>...` splits a profile by direct children. Round 3's `goal6.py` makes the run table.
- The setup took 30 s for 25 daemons, and the whole round 2.5 minutes from the first start to all down. The time goes to waiting for the load.
- To measure at exactly 25 daemons, start 25 less the host's own. The host had 7 to 10 during this round.
