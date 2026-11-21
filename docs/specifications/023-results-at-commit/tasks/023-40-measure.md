# Row 023-40: a commit daemon's start time and memory, measured on a quiet machine

Version: cand/0.1.592 (`15417c90c`), the built plugin bundle `plugins/claude-code/dist/cli/squeal.mjs`, not `tsx`.
Machine: a boat.dev `default` sandbox, 4 vCPU, 8 GB RAM, 2 GB swap, AMD Ryzen 9 9950X, Node 24.22.1, pnpm 12.15.0 (the version `packageManager` pins), git 2.43. Nothing else ran on it. Date: 2026-11-21.
Subject: this repository (2,105 test files), as a 4-commit chain whose trees are those of cand/0.1.592~3 to cand/0.1.592. The user worktree is at the tip; every call asks for `HEAD~1` (the tree of `f429d7455`).
Raw data, scripts and profile summaries: [`../probes/023-40-measure/`](../probes/023-40-measure/).

## Summary

| Question | Answer |
|---|---|
| Daemon start: from the claim until the daemon serves (the lookup-only pass) | **31 s** median (26–49 s) when nothing else starts; **53 s** (42–65 s) when the worktree daemon starts at the same time |
| From the call until the named file's result is stored at the commit | **47 s** (40–75 s) quiet; **88 s** (70–105 s) contended |
| Where the start goes | About 80% is the import walk over every test file in the runner-host child (parse and resolve every source file, about 20 s CPU, one thread). The daemon's main thread waits. Then 1–2 s to encode and store 4,290 closure rows. |
| Memory of one commit daemon (daemon process plus its runner-host) | Start peak **1.5 GiB PSS** (1.6 GiB RSS). Idle in the first minute 1.2 GiB PSS; after its 60 s idle GC **0.73 GiB PSS** (0.83 GiB RSS). While running a group of 40 files with 4 workers: peak **2.0 GiB PSS** (3.1 GiB RSS). |
| Does D7.4's 1 GB per daemon hold | **No.** A daemon that starts or runs tests uses 1.5 to 2.0 GiB PSS. Three commit daemons starting at once on 8 GB took MemAvailable down to 205 MiB and pushed 256 MiB into swap. |
| Recommendation | Per-daemon estimate **2 GiB** (start and run peak, PSS, on 4 workers), so 8 GB of free memory allows 3 to 4 commit daemons, not 7 to 8. Start time: a first `--run` call on a 4-CPU laptop needs 45 to 90 s before the commit side has a result; the 100 s wait holds in the quiet case and is tight when other daemons start. |

**Blocker found on the way (already sent to the coordinator and the reviewer):** in all 18 runs the commit daemon stored the named file's result at a different key than the call reads (`31ba6e218a52` against `65938cf808a8`). So the call never reports the file as done: "not determined (the daemon stored it at key ..., not at this call's ...)", exit 3. The differing input is the shared observed set (store meta `observed.`). The call keyed the file before any run, when no observed set existed. The first run (in either daemon) observed 4 more files (`package.json`, `pnpm-workspace.yaml`, `src/core/code/coverage/provider.mjs`, `src/runners/observe/recorder.cjs`). They entered the key's segments, so the daemon stored the result at the larger key. A plain `status --at HEAD~1 <file>` after the run keys again, reads the observed set and reports the pass ("1 unchanged"). The call keys once at its start and never keys again after the run. Every file run for the first time, or whose run observes new paths, hits this.

## Method

- Each run starts from a fresh Squeal state: every daemon stopped, the repository's `.git/squeal` and `~/.cache/squeal` deleted, git worktrees pruned.
- Two batches:
  - **Clean (batch 2, 6 runs):** `squeal start` in the user worktree. The script waits until that daemon's log says "serving" and then 20 s more. Then `squeal status --at HEAD~1 test/daemon/commit-removal.test.ts --run`. Package store warm. Three of these runs then ran 40 test files in the commit daemon (`squeal run tests <40 files of test/scheduler> --wait 400000` in the commit worktree) after 90 s idle.
  - **Contended (batch 1, 9 runs):** the same call, but the worktree daemon was still running its own lookup pass for most of the commit daemon's start. In `cold` and `warm` it started about 15 s before the call (a script error: the wait for it returned early); in `both` it was started by the call itself, as with no daemon running. `cold` emptied the package store first.
- A sampler read `/proc` every 200 ms: RSS (`VmRSS`) and PSS (`smaps_rollup`) of each daemon process and all its descendants, MemAvailable and load, the commit worktree's marker (folder made, installed, claimed) and the store's `results` rows for the named file. It used about 0.2 CPU itself. Phase times come from these samples, the daemon logs and the call's own output.
- Install alone: `git worktree add --detach` at `HEAD~1` and `pnpm install --frozen-lockfile` in it, three times with an empty package store and three times with a warm one.
- CPU profiles: one call with `NODE_OPTIONS=--cpu-prof`, which every Node process it starts inherits (the commit daemon, its worker threads and its runner-host). One in each batch.
- Times are seconds from the call's start unless the row says otherwise; medians with the range in brackets.

## Times

### The call, phase by phase

| Phase | Clean (n=6) | Contended (cold and warm, n=6) | Both start together (n=3) |
|---|---|---|---|
| Keying at the commit in a temporary checkout (the call's report) | 12.3 (11.2–18.4) | 23.4 (18.5–27.8) | 20.0 (18.7–20.0) |
| `ensureCommitWorktree` in the call: folder to installed (warm store, after the keying's install) | 1.2 (0.9–1.8) | 1.8 (1.5–1.9) | 2.0 (1.8–2.0) |
| Commit daemon claimed the worktree | 14.3 (12.7–21.0) | 30.4 (23.8–34.5) | 26.8 (24.9–26.8) |
| **Claim to "serving" (the start)** | **31.0 (25.9–49.2)** | **52.5 (41.7–63.0)** | **59.0 (54.8–65.3)** |
| Commit daemon serving | 45.3 (38.6–70.1) | 83.2 (66.1–97.6) | 83.9 (81.6–92.1) |
| Named file's result stored at the commit, after "serving" | 1.9 (1.7–4.6) | 5.2 (4.0–7.2) | 10.9 (7.6–15.2) |
| **Named file's result stored at the commit** | **47.4 (40.3–74.7)** | **88.3 (70.0–104.8)** | **92.5 (91.5–107.2)** |
| The call ends (exit 3 every time, the key blocker above) | 48.1 (41.2–75.0) | 89.1 (71.0–100.5) | 93.0 (92.5–100.5) |
| `squeal stop --at HEAD~1` returns | 0.2 (0.2–1.1) | 0.3 (0.2–1.6) | 0.4 (0.3–0.5) |
| Worktree gone, from the stop | 0.8 (0.8–1.1) | 1.3 (1.0–1.6) | 1.4 (1.1–1.8) |

The call ends as soon as the commit daemon has run the file (it no longer lists it as pending), not at 100 s. It still ends with exit 3 because it reads the file at the old key. In two contended runs the result came after the call had ended (at 104.8 and 107.2 s).

The clean starts got shorter from run to run (49, 39, 31, then 27, 26, 31 s). The worktree daemon was serving 20 s before every call, but the first runs may still have shared the machine with its work after "serving" (its integrity check, the code store). 31 s is the median; 26 s is the best case on this machine.

### `ensureCommitWorktree` alone

| | `git worktree add` | `pnpm install --frozen-lockfile` |
|---|---|---|
| Empty package store (cold) | 1.3 s (1.1–1.4) | 3.4 s (3.0–3.7) |
| Warm package store | 1.2 s (1.1–1.2) | 0.34 s (0.29–0.40) |

In the call, the keying's temporary checkout installs first, so the commit worktree's install always finds a warm store: a cold store costs the keying's install, not the commit worktree's. The sandbox's network is fast; research Q2 measured 4.7 to 10.9 s cold elsewhere.

### Against the first estimate (023-40 notes, the development host)

| Step | Host estimate (16 CPUs, load 11–12, from source under `tsx`) | This run (4 vCPU, quiet, bundle) |
|---|---|---|
| Worktree add and warm install | 2.2 s | 1.2 s in the call |
| Start until ready and claimed | 20.8 s | 31 s claim to serving (+14 s before the claim) |
| One named file, from the start | 26.6 s | 47 s from the call |
| Stop and removal | 1.3 s | 0.8 s |

The start is mostly one busy thread, so the number of CPUs matters less than per-core speed and what else runs. Why the host's in-process run was faster was not measured here (it ran in one process from source, on another CPU model, under load 11). A laptop with 4 to 8 cores should expect 30 to 50 s.

## Where the start goes

The commit daemon's start, from the clean profile (claim at 0 s, "serving" at 31 s):

| Time | Process | Work |
|---|---|---|
| 0–2 s | daemon | boot, store open, git index read |
| 2–27 s | runner-host child | the import walk over all 2,105 test files: parse each source file through Vite's parser (`jsonParseAst`, `parseSync`), tsconfig transforms (`transformSync`), resolve imports (`visit`, `importTargets`, `depToPath`, `fileImports`). About 20 s CPU in 25 s; one thread busy, 3 vCPUs idle. |
| 25–31 s | daemon | `encodeImports` and `storeClosures`: 4,290 closure rows, the store's write lock held about 2 s |
| 0–31 s | daemon main thread | idle 86% (38 of 45 s profiled); the two worker threads idle 99% |

Under contention (both daemons walking, plus the keying) the same walk took 47 s of a 57 s start (`profiles/contended-runner-host.txt`).

The same walk runs three times for one call: in the worktree daemon (already done for nearly the same files), in the call's keying in the temporary checkout (the call's profile shows the same parser frames, about 8 s CPU), and in the commit daemon. HEAD and HEAD~1 differ in 45 files.

What would cut it (no product change made here):

1. **Reuse import edges by content.** Store each source file's resolved imports keyed by its content hash (and the resolution inputs), and parse only files whose hash is new. Between neighbouring commits that is a few dozen files, so the walk drops from about 20 s to well under a second. This also cuts the keying in the temporary checkout and every worktree daemon's start.
2. **Walk once per call.** The commit daemon could take the call's keying result (closures and keys), or the call could read the live commit daemon's keys (research Q4, 023-40 notes decision 1). Either removes one full walk, and the second also fixes the key blocker for a daemon that is already up.
3. **Start the commit daemon while the call keys** (023-40 notes decision 2): about 12 s off the quiet case, at the cost of a daemon for calls that select nothing.
4. **Use more than one thread for the walk.** It is CPU-bound on one core while 3 of 4 are idle.

## Memory

All values in MiB. "Tree" is the commit daemon process plus every descendant (its runner-host, store children and test workers). PSS divides shared pages among the processes that map them; it is the better measure of what a daemon adds.

### One commit daemon

| State | Tree RSS | Tree PSS | Daemon process RSS | Runs |
|---|---|---|---|---|
| Start peak (until "serving") | 1,603 (1,515–1,656) | 1,499 (1,414–1,554) | | clean, n=6 |
| Idle, first 30 to 55 s after the file | 1,293 (1,240–1,420) | 1,190 (1,148–1,327) | 768 (749–876) | clean, n=6 |
| Idle after its 60 s "last-resort GC" (daemon log: private memory 692–819 → 235–259 MiB) | 828 (807–857) | 735 (715–764) | 312 (293–317); runner-host 491–563 | clean, n=3 |
| Running 40 test files (`test/scheduler`), 25–26 processes | peak 3,148 (3,097–3,174) | peak 1,954 (1,954–2,004) | | clean, n=3 |
| Idle after the 40 files | 904 (879–941) | 815 (791–852) | | clean, n=3 |

Contended runs gave the same levels (start peak PSS 1,441, idle 1,184). The 40 files took 264 s (263–288 s).

### Three commit daemons at three commits

Three `status --at HEAD~1|2|3 <file> --run` calls started at once, with the worktree daemon idle, then 40 test files in each commit daemon at once.

| State | Sum of the 3 trees, RSS | Sum, PSS | Per daemon PSS | MemAvailable (min) |
|---|---|---|---|---|
| The three starts (with the three calls' keying processes, about 0.8 GiB RSS each, outside these sums) | peak 3,089 | peak 2,964 | | **205** |
| Idle, first minute | 3,016 (peak 3,327) | 2,834 (peak 3,146) | about 945 | 3,164 |
| Idle after 60 s (two of three had run their GC) | 2,165 | 2,038 | about 270 after GC, 1,600 before | 4,272 |
| 40 files each, at once (33 processes) | peak 6,567 | peak 4,229 | about 1,400 | 2,092 |

Batch 1 gave the same idle sum (2,786 PSS) and a start minimum of 742 MiB available.

On 8 GB the three starts nearly exhausted memory, and 256 MiB went to swap. The three groups of 40 files did not finish in 600 s: one daemon still had 2 files pending at the deadline (`three-group-deadline.out`). The three keying calls took 18, 27 and 33 s (49 to 76 s in batch 1).

### The per-daemon estimate

D7.4 divides free memory by 1 GB. Measured, a commit daemon uses about 0.75 GiB PSS when idle after its GC, 1.2 GiB in its first idle minute, 1.5 GiB while it starts and 2.0 GiB while it runs tests with 4 workers. The call that starts it holds about 0.8 GiB more while it keys. The ceiling counts daemons that will start and run, so use the peak: **2 GiB per commit daemon**. With 1 GB, an 8 GB machine with 7 GB free would allow 7 commit daemons; measured, 3 starting at once already took it to 205 MiB available. Run memory grows with the worker count, so a machine with more cores (more Vitest workers) needs more per running daemon; free memory divided by 2 GiB still leaves room on 8 to 16 core laptops, where free memory is larger too.

This is for a repository of 2,105 test files. The closure maps scale with the repository; a small repository needs less. The bench fixture repositories (size S and L) were not measured.

## Cost

One `default` sandbox, 20:19 to 22:09 UTC (1 h 50 min), at $0.036 an hour: about $0.07, inside the plan's included hours. It was created with `--no-env` and deleted at the end.
