# Rows 023-40c and 023-46 after review round 4: a commit daemon's start, first result and memory, third measurement

Version: cand/0.1.594 at `2b8d9297c`. The start's shortcut uses the strict rule only: a stored walk proves a miss only when its list names no path absent here (`c317034eb`; option B was reverted). This version also has the lock-deadline fixes (`dbf4405ea`, `cf9db70fb`) and the ceiling fix (`12b8f3b2c`). Measured on the built plugin bundle `plugins/claude-code/dist/cli/squeal.mjs`, not `tsx`.
Machine: a boat.dev `default` sandbox, 4 vCPU, 8 GB RAM, 2 GB swap, Node 24.22.1, pnpm 12.15.0, git 2.43. **CPU: AMD Ryzen 7 9700X, not the Ryzen 9 9950X of the first two measurements.** The size does not fix the CPU. So the same sandbox also ran the 023-40c bundle (`d0925e820`) as a baseline. Date: 2026-11-22.
Subject: the same as [`023-40-measure.md`](023-40-measure.md) and [`023-40c-measure.md`](023-40c-measure.md): this repository as a 4-commit chain whose trees are those of `15417c90c~3` to `15417c90c` (2,105 test files). The user worktree is at the tip. Every call is `squeal status --at HEAD~1 test/daemon/commit-removal.test.ts --run`. HEAD and HEAD~1 differ in 45 files.
Raw data, scripts and profile summaries: [`../probes/023-40e-measure/`](../probes/023-40e-measure/).

## Summary

| Question | Answer |
|---|---|
| The call's total time (quiet, warm package store) | **16.6 s** (14.9–18.4 s), n=9. The 023-40c bundle on the same machine: **14.8 s** (13.6–15.7 s), n=3. In 023-40c (9950X): 10.6 s. Of the 6 s gap to 023-40c, about 4 s is the machine and about 2 s is this version. |
| Is the first call's result right | **Yes, in every call.** All 46 first calls read the named file's pass at the commit in the same call ("1 unchanged", exit 0). On the first sandbox that is 26 calls: 9 clean, 3 cold, 3 both, 4 counting reps, 6 baseline, and the 3 calls at once. On the second sandbox it is 20: 4 group reps and 16 on 0.1.595. |
| **A second call at the same commit (warm daemon)** | **Defect in 0.1.594, fixed in 0.1.595.** In 0.1.594, 4 of 18 second calls exit 13 after about 1.1 s and print nothing. Node says "Detected unsettled top-level await". None of the 8 second calls on the 023-40c bundle failed. The calls that end print the right result in 1.5 s (1.4–1.8 s), the same as the baseline's 1.5 s. See finding 1. **On the 0.1.595 bundle (`b245be4d0`), all 16 second calls exit 0** with the pass read, in 0.9 s (0.7–1.4 s). |
| Files walked at the commit daemon's start | **114 to 115 of 2,105.** 80 have no stored walk at their key, the same 80 as row 023-46 measured. 34 to 35 more are walked because their list names an absent path. The strict rule costs these 34 to 35 walks here, not about 600. |
| Commit daemon: spawn to serving | **10.5 s** (8.6–12.0 s). Baseline 9.9 s (8.0–10.0 s). 023-40c: 8.0 s on the 9950X. |
| Commit daemon: spawn to the named file's result | **13.9 s** (12.2–15.6 s). Baseline 12.7 s (11.2–12.9 s). |
| Both daemons start with the call (fresh store) | Call **42.1 s** (41.3–46.0 s), exit 0, the pass read. Baseline **50.6 s** (47.9–54.5 s). This version spawns the commit daemon 3.7 s earlier (1.5 s against 5.2 s), and its start is shorter (28.8 s against 34.0 s). |
| Three calls at once at three commits | **All three commit daemons start.** All three calls end in 20.8 to 23.0 s with exit 0 and the pass read. In 023-40c the third call waited 98 s and ended "unknown". The ceiling fix works. |
| Memory of one commit daemon (PSS, daemon plus children) | Start peak **0.90 GiB** (baseline 0.86). Idle in the first minute 0.72 GiB (baseline 0.67). Idle after its GC 0.53 GiB. Running 40 files on 4 workers: peak **1.79 GiB** PSS (1.77–1.83), 2.95 GiB RSS, in the groups that ended. |
| Three commit daemons | Start: 2.81 GiB PSS for all three (about 0.94 each), MemAvailable at least 2.1 GiB. Three groups at once: peak 3.92 GiB PSS together, MemAvailable at least 2.1 GiB, no swap seen. |
| The 40-file group | It is slow on this CPU **for both bundles**. On the second sandbox the 023-40c bundle took 674 s and more than 900 s, and this version took 545 s and 619 s. Each had 5 or 6 failures, from the subject's own timing-bound scheduler tests (the same tests in both). The 244 s of 023-40c was the faster machine. |
| Recommendation | **Keep 2 GiB per commit daemon.** No number measured here goes past it (group peak 1.83 GiB PSS). Start time: about 14 s from spawn to the first result on this CPU. The strict rule adds about 1 s here, and a fresh store adds about 30 s. The 100 s bound is wide. Finding 1 is fixed in 0.1.595 (checked below). |

### The 40-file group on the same machine (second sandbox, also a 9700X)

| Group of 40 files (`test/scheduler`), 4 workers, wait 900 s | 023-40c bundle | 0.1.594 |
|---|---|---|
| Rep 1 | 900 s, the wait ended with 1 file pending; 6 failures | 619 s, done; 6 failures |
| Rep 2 | 674 s, done; 6 failures | 545 s, done; 5 failures |
| Peak tree PSS / RSS (MiB) | 1,736 / 2,942 and 1,780 / 2,974 | 1,812 / 3,019 and 1,872 / 3,082 |
| The call before the group, spawn to "serving" | 11.8 and 12.3 s | 14.1 and 13.5 s |

The failures are the subject's own tests that are bound by wall time (`test/scheduler/backlog-wall.test.ts` "Test timed out in 5000ms" and the like). They fail on this CPU with either bundle. The version does not make groups slower. In the first sandbox the groups hit the 400 s wait with 24 files pending (`calls/group-1.group.out`).

### The fix of finding 1 (0.1.595, `b245be4d0`), on the second sandbox

16 reps of the call and its second call: 13 with the worktree daemon first, and 3 with both daemons starting with the call. These are the cases where 0.1.594 exited 13.

| | 0.1.594, both sandboxes | **0.1.595** |
|---|---|---|
| Second calls with exit 0 | 14 of 18 (4 exit 13, no output) | **16 of 16**, "1 unchanged" in each |
| Second call, time | 1.5 s (1.1–1.8) on the first sandbox; 0.8 s on the second | 0.9 s (0.7–1.4) |
| First call, worktree daemon first | 16.6 s (first sandbox); 19.0 s (18.8–19.2), n=2 (second sandbox) | 20.9 s (15.5–27.5), n=13 |
| First call, both daemons start with it | 42.1 s (first sandbox) | 43.7 s (42.2–48.3), n=3 |

The second sandbox is slower than the first: the 023-40c bundle's call took 16.4 s there, against 14.8 s on the first. 0.1.595 changes only the CLI's wait between 0.1.594 and it (`c567c43bf`). The commit daemon's start is the same code. So the 0.1.595 first-call times are in the range of the same machine's run-to-run spread. They are not a slowdown of the start. Its reps ran back to back with a 5 s idle (`IDLE=5`), not 30 s.


### Findings

1. **A `--run` call can exit 13 with no output** (`src/cli/status-at-now-ask.ts:56`, `src/cli/status-sync.ts:163`). This is new in this version: `56051da01` makes the call ask the worktree daemon a `sync`. `askNow` awaits only `sync.answered`. While the daemon's answer is pending (revision `null`), `syncOnce` polls with `sleep(pollMs, undefined, { ref: false })`. If no other handle is open at that moment, the event loop empties, and Node ends the process with exit code 13 ("unsettled top-level await"). The call prints nothing on stdout. It happened in the second call, 2 s after a first call whose "now" side had queued the named file in the worktree daemon. So that daemon was still busy and answered "pending". Counts: group-3, both-1, both-2 and count-quiet-2: 4 of 16 on the first sandbox, 0 of 2 in the group check, so 4 of 18 on 0.1.594. 0 of 8 on the 023-40c bundle. The unref'd sleep is right for `status --wait`, where the outer `pollPause` holds a ref'd timer. `askNow` has no such timer. Fix: a ref'd keep-alive in `askNow` until `answered` settles. The coordinator made this fix in 0.1.595 (`c567c43bf`), and 16 of 16 second calls then exit 0 (see above). No product code was changed in this task.
2. **The strict rule costs 34 to 35 walks here.** The instrumented counting copy (`scripts/instrument.mjs`; used only in the `count-*` reps, never timed) logs the start's split: 1,990 to 1,991 proven, 80 "no walk at key", 34 to 35 "absent path", 0 "no key" or "no list" (`walks.jsonl`). The "about 600" estimate in the 023-46 notes came from the development store, where lists from other branches' trees are the newest. Here only the worktree at the tip wrote lists. Its lists name its own absent paths, such as the `package.json` lookup chain, only in a few files. Those few paths are absent at the commit too. On a store with many branches the count can be higher; this run does not measure that.
3. **The commit daemon spawns sooner when both daemons start together:** at 1.5 s, against 5.2 s for the 023-40c bundle on the same machine. The call no longer waits behind the worktree daemon's start before it places the commit worktree (lock-deadline fixes, `cf9db70fb`, `dbf4405ea`). That is most of the both-case gain (50.6 s down to 42.1 s).
4. **The second call takes 1.5 s on this machine, for both bundles.** It took 0.45 s in 023-40c. So this is the machine, not the version.

## Method

The same as `023-40c-measure.md`: the same driver (`scripts/run.sh`), sampler, quiet wait and analysis scripts. Only these steps are new:

- **Baseline in the same sandbox:** `base-quiet-1..3` and `base-both-1..3` run the 023-40c bundle (`git archive d0925e820 plugins/claude-code`) with the same driver.
- **Counting reps:** `count-quiet-1..3` and `count-both-1` use a copy of the bundle with three log lines added (`scripts/instrument.mjs`). The lines record the unresolved walk's size and the recheck's split by reason. These reps are counted in the call-time medians ("n=9"), since the added lines cost nothing measurable. Without them, the 6 clean reps give 16.4 s (14.9–18.4 s).
- **Group check, second sandbox (also a 9700X):** the 40-file group hit the driver's 400 s wait in all three group reps. So a second sandbox ran the group with the 023-40c bundle and with this version, alternating, 2 reps each, with a 900 s wait (`groups2`). The same sandbox then ran 16 reps on the 0.1.595 bundle (`scripts/run2.sh second595`).
- The chain is built again with `git commit-tree` on the same trees. Its commit ids differ from 023-40c's (tip `5ca787002`, HEAD~1 `268632654`), but the trees are the same.
- The `both` profile wrote no files (the `prof-both` folder is empty). Only the quiet profile is summarised.
- Times are seconds from the call's start unless the row says otherwise. Values are medians with the range in brackets.

## Times

| | 023-40 (`15417c90c`, 9950X), n=6 | 023-40c (`d0925e820`, 9950X), n=6 | 023-40c bundle on this 9700X, n=3 | **This version (`2b8d9297c`, 9700X), n=9** |
|---|---|---|---|---|
| **The call ends** | 48.1 (41.2–75.0) | 10.6 (9.6–12.8) | 14.8 (13.6–15.7) | **16.6 (14.9–18.4)** |
| Exit and the file's state | 3, "not determined" | 0, "1 unchanged" | 0, "1 unchanged" | **0, "1 unchanged", 9 of 9** |
| Commit daemon spawned | not measured | 0.8 (0.7–1.1) | 1.4 (1.3–1.5) | 1.5 (1.4–1.6) |
| Claimed the worktree | 14.3 (12.7–21.0) | 1.2 (1.2–1.4) | 1.9 (1.8–1.9) | 2.0 (1.8–2.1) |
| Folder made to installed (warm store) | 1.2 (0.9–1.8) | 1.9 (1.8–2.1) | 2.2 (2.1–2.3) | 2.4 (2.1–2.9) |
| Claim to "serving" | 31.0 (25.9–49.2) | 7.6 (5.8–8.7) | 9.5 (7.5–9.6) | **10.1 (8.2–11.4)** |
| Spawn to "serving" | not measured | 8.0 (6.0–9.2) | 9.9 (8.0–10.0) | **10.5 (8.6–12.0)** |
| Named file's result, after "serving" | 1.9 (1.7–4.6) | 1.6 (1.4–1.9) | 3.0 (2.7–3.1) | 3.2 (2.8–5.9) |
| Named file's result at the commit | 47.4 (40.3–74.7) | 10.3 (8.6–11.8) | 14.2 (12.5–14.3) | **15.4 (13.6–17.2)** |
| Spawn to that result | not measured | 9.6 (7.4–11.0) | 12.7 (11.2–12.9) | **13.9 (12.2–15.6)** |
| Second call, time | not measured | 0.45 (0.4–0.5), n=12 | 1.5 (1.5–1.5) | 1.5 (1.1–1.8) |
| Second call, exit | not measured | 0 in 12 of 12 | 0 in 3 of 3 | **0 in 7 of 9, 13 in 2** |
| `squeal stop --at HEAD~1` returns | 0.2 (0.2–1.1) | 0.6 (0.1–0.7) | 0.8 (0.2–0.9) | 0.2 (0.1–1.9) |
| Worktree gone, from the stop | 0.8 (0.8–1.1) | 0.7 (0.6–0.8) | 0.8 (0.8–0.9) | 0.8 (0.7–2.5) |

| Both daemons start with the call, n=3 | 023-40 | 023-40c (9950X) | 023-40c bundle, 9700X | **This version, 9700X** |
|---|---|---|---|---|
| The call ends | 93.0 (92.5–100.5), exit 3 | 31.5 (30.0–32.8), exit 0 | 50.6 (47.9–54.5), exit 0 | **42.1 (41.3–46.0), exit 0** |
| Commit daemon spawned | not measured | 2.5 (2.5–2.6) | 5.2 (5.1–6.1) | **1.5 (1.5–1.7)** |
| Spawn to "serving" | not measured | 25.2 (22.8–26.1) | 34.0 (29.8–35.6) | 28.8 (27.0–32.9) |
| Named file's result at the commit | 92.5 (91.5–107.2) | 31.2 (29.2–32.2) | 47.3 (44.4–53.1) | 37.6 (36.1–45.2) |
| Worktree daemon serving | (not reported) | 22.9 (22.8–23.2) | 37.4 (35.6–37.6) | 30.1 (28.5–32.7) |
| Second call, exit | | 0 | 0, 0, 0 | **13, 13, 0** |

In `count-both-1` both daemons walked all 2,105 files ("unresolved"), as in 023-40c: no stored list exists yet when they start.

| Empty package store, n=3 | 023-40c (9950X) | This version (9700X) |
|---|---|---|
| The call ends | 12.9 (11.1–13.5) | 19.1 (19.0–19.3), exit 0, "1 unchanged" |
| Folder made to installed | 4.2 (4.1–4.4) | 4.9 (4.7–5.1) |
| Spawn to "serving" | 10.4 (8.8–11.0) | 13.3 (13.2–13.5) |
| Named file's result at the commit | 12.8 (10.9–13.4) | 17.9 (17.7–18.2) |

`ensureCommitWorktree` alone (`installs.jsonl`): `git worktree add` 0.94 s cold and 0.82 s warm; `pnpm install --frozen-lockfile` 3.21 s with an empty store, 0.63 s with a warm one. 023-40c measured 2.78 s and 0.23 s.

### Three calls at once

All three calls ran at `HEAD~1`, `HEAD~2` and `HEAD~3` after the worktree daemon was quiet. All three commit daemons started. The calls ended in 23.0, 23.0 and 23.5 s with exit 0 and the pass read; their reports say 20.8, 21.1 and 23.0 s to the result. MemAvailable was at least 2,182 MiB during the calls. With the old ceiling the third call would have waited (023-40c: "2 of 2 commit worktrees live").

## Where the start goes now

The quiet start, seconds from the commit daemon's spawn (`start-phases.txt`, profile `profiles/quiet-*.txt`):

| Time | Work |
|---|---|
| 0–0.5 | daemon boot; claims the worktree |
| 0.5–1.7 | `pnpm install --frozen-lockfile` (pnpm seen at 1.3–1.6 s) |
| 1.7–3.9 | daemon main thread: scan, stat cache, keys from the stored lists |
| 3.9 | runner-host child spawned (023-40c: 3.5) |
| 3.9–10.5 | runner-host: Vitest load, then the 114 to 115 walks (023-40c: 80); the closure rows are stored; "serving" |
| 10.5–13.9 | the named file runs; its result is stored about 3.2 s after "serving" (1.6 s in 023-40c on the 9950X; 3.0 s for the baseline here) |

CPU in the quiet profile: the daemon main thread was busy 4.0 s of 24 s (`lstat` 0.4 s, hashing 0.3 s), and the runner-host 3.6 s of 20 s (Vite's `parse` and the resolver about 1.5 s). In 023-40c these were 3.3 s and 2.5 s. The extra second in the runner-host fits the 35 extra walks. Both processes were idle most of the time, as before.

What would cut it further (no product change made here):

1. **The strict rule's extra walks are small here (about 1 s).** A store that holds lists from many branches would raise the count. The way out is the one row 023-46 names: prove an absent path by the writer's key. That needs a sound rule (option B was reverted). It is not worth it at this size.
2. **The both case:** both daemons still walk all 2,105 files at once. A walk store shared by content hash across worktrees would cut it most (023-40c's point 1).
3. **The runner-host could spawn during the install** (023-40c's point 2). It would save about 2 s.

## Memory

All values in MiB. "Tree" is the commit daemon process plus every descendant.

| State | This version, tree RSS | This version, tree PSS | Baseline here, PSS | 023-40c, PSS (9950X) |
|---|---|---|---|---|
| Start peak (until "serving"), clean | 1,008 (986–1,040) | **917 (890–942)** | 879 (876–891) | 881 |
| Start peak, both daemons start together | 1,521 (1,473–1,527) | 1,426 (1,371–1,432) | 1,415 (1,413–1,435) | 1,402 |
| Idle, first minute after the calls | 825 (814–838) | 733 (721–745) | 684 (667–705) | 692 |
| Idle after its 60 s GC (group reps) | 637 (623–639) | **545 (530–547)** | | 541 |
| Running 40 files (`test/scheduler`), first sandbox, until the 400 s wait ended | peak 2,972 (2,944–3,035) | peak 1,798 (1,790–1,806) | | 1,704 |
| Running 40 files, second sandbox, the groups that ended | peak 3,019 and 3,082 | peak **1,812 and 1,872** | 1,736 and 1,780 | |
| Idle after the group | 1,407 (1,356–2,191) | 1,146 (1,059–1,390) | | 575 |

The memory after the group is high because the group had not ended: its wait ran out with 24 files still pending (see the group section).

Three commit daemons (`three.txt`):

| State | Sum of the commit trees, RSS | Sum, PSS | Per daemon at the RSS peak | MemAvailable (min) |
|---|---|---|---|---|
| The calls (24 s, three daemons start) | peak 3,321 | peak 2,873 | 1,001, 1,042, 1,278 RSS | 2,182 |
| Idle, first 55 s | median 2,258 | median 1,927 | | 2,907 |
| Idle after the GC | 1,751 | 1,420 | 603, 536, 613 RSS | 4,420 |
| 40 files in each of the three, at once (602 s, the wait's end) | peak 6,025 | peak 4,014 | 2,415, 1,654, 1,956 RSS | 2,110 |

The worktree daemon held 1,773 MiB RSS (median) during the three starts and about 516 MiB during the groups.

### The per-daemon estimate

| State | PSS per commit daemon |
|---|---|
| Idle after GC | 0.53 GiB (three at once: 0.46) |
| Idle, first minute | 0.72 GiB |
| Start, with stored walks | 0.90 GiB (three at once: 0.94) |
| Start, full walk | 1.39 GiB |
| Running a group on 4 workers | 1.76 to 1.83 GiB (three at once: 1.31 on average) |

**2 GiB stays right.** No state goes past it, and three running groups on 8 GB left 2.1 GiB available. The admission rule of `12b8f3b2c` (live daemons plus one per 2 GiB free) let the third daemon start, and the machine held it.

## Cost

Two `default` sandboxes, created with `--no-env` and deleted at the end. The main run took 07:30 to 08:45 UTC (1 h 15 min). The group check and the 0.1.595 reps took 08:46 to 10:06 UTC (1 h 20 min). In total that is 2 h 35 min at $0.036 an hour, about $0.09, inside the plan's included hours.
