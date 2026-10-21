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
