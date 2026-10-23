# 011-161: what departure drains do since 011-93

Researcher of row 011-161, 2026-10-23, 19:30Z to 20:45Z. Brief: `research/drains-brief.md`. Read: `tasks/011-84/design.md` 1 and 2, its `probes/README.md` and `drains.py`; `research/stored-nothing.md`; `research/missed-sharing.md` (method only); spec 011 C9 and C10, 004 D2 as amended 2026-10-21; `src/core/daemon/lifecycle.ts`, `Scheduler.pauseBacklog`, `owedWork`, `slow-tier.ts`.

Versions: source at this branch's base `a6d2f6c61` (0.1.278). The drains ran 0.1.275 (1), 0.1.276 (2) and 0.1.278 (22); 3 have no version in their notes. Since: the `squeal--v0.1.253` tag commit, 2026-10-22T04:38:09Z. Copies: the cezar, squeal and toolkit-dev stores with `-wal` and `-shm` at 19:32:47Z (c0) and 20:20:21Z (c1); cezarion's `runs.db` of cezar and squeal with each; the run reports since 10-22 right after each. `/proc`: 45 samples a minute apart, 19:35:52Z to 20:19:51Z, with a reduced store copy every 5 minutes. One-minute load in the window: 6.2 to 61.9, median 33.3, on 24 CPUs. No live store, socket or permit pool was opened; `squeal ps` was not used. Probes and how to re-run each: `probes/drains/README.md`.

**Units.** A *drain* runs from its start note ("the last session ended with … pending") to the note that ends it. *Recorded seconds* are per-file durations in run reports. One recorded second cost 0.32 to 0.59 CPU-seconds on this host (`edit-load.md` 0). *Read later*: a lookup moved `last_used_at` more than 60 s past `recorded_at` (011-84's rule).

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Drains since 0.1.253 | 1,355 daemon-minutes in 28 drains of 24 cezar worker worktrees, all on 2026-10-23 (14:33Z to 20:20Z). Squeal and toolkit-dev: 0. All 28 drained for slow files (the e2e files, 34 to 85 queued), 5 for re-runs too. Ended: the 60-min bound 17, a session registered 6, a signal 2, a step-down 1, open at the copy 2; drained 0, worktree removed 0. No run was in flight for 1,170 of the 1,355 minutes (86%). 10 of the 17 bound drains ran nothing, and 14 ran no slow file. Runs: 142 slow (3,329 s wall), 74 fast (311 files, 8,302 s), 23,424 recorded s, about 7,500 to 13,800 CPU-s | read from store |
| 2 | Memory | Draining daemons held 638 to 3,516 MiB at a time (mean 1,759 MiB, 2 to 8 daemons; 18.6% of all Squeal daemon PSS), about 350 MiB each, and test processes 0 to 389 MiB (mean 83). A waiting drain used 0.64 CPU-s a minute. In 202 of 226 draining daemon-minutes the slow lane was `waiting for slot` | verified by experiment |
| 3 | Worth | Of 11,686 results: 2,906 (24.9%) read later, 2,185 at a key another live worktree holds now. 471 (one drain) were deleted with the worktree, never read, 4 h after the drain. In the 48 cezar worker worktrees removed since 0.1.253, no run after the task's finish survives. Of the 471, 0 sit at a key another worktree holds | read from store |
| 4 | Who drains | Worker worktrees (`.ai/cezar/worktrees/*`): 28 of 28. Main checkouts: 0. Others: 0. Departure to removal: 1 of the 24 drained worktrees was removed, 302 to 307 min after its departure; the other 23 still stood 43 to 276 min after it at 20:20Z. Removed workers in general: cezar median 1.4 min after the finish (p75 8.2, p90 15.1; n 48), squeal 6.2 min (p75 46.8, p90 129.6; n 118) | read from store, inferred (finish as departure) |
| 5 | Options | Over 1,312 minutes of 25 drains with a known end, at a 60 s gap: (a) saves 1,226 daemon-min, 429,085 MiB-min, 3,200 to 5,300 CPU-s and loses 1,762 read-later results; (a′, only slow waits) 1,139 min, 398,482 MiB-min, 1,800 to 2,600 CPU-s, 581 lost; (b) 947 min, 331,408 MiB-min, 4,000 to 6,900 CPU-s, 435 lost; (c) 1,311 min, 458,792 MiB-min, 7,400 to 12,900 CPU-s, 1,789 lost; (d) 0. Lost read results are 2 to 3 drains, and depend on the gap | verified by replay (model) |

## 1. Drains since 0.1.253

`drains.py` reads every drain from each copy's notes. A bound stop note whose start note was evicted counts as starting 60 min earlier, as 011-84's script counts it. The two copies are merged: c0 holds drains whose notes later scrolled out, c1 holds drains that started after 19:32Z (`results/drains-cezar-merged.jsonl`, one line per drain).

| How it ended | n | Minutes | No run in flight | Fast runs (files, wall s) | Slow runs (wall s) | Results | Read later |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the 60-min bound, slow files still pending | 17 | 1,019 | 904 | 23 (89, 4,696) | 124 (2,355) | 5,774 | 1,789 |
| a session registered (inferred: another start note, a consumer, or the unused exit, which skips a drain, `lifecycle.ts:266`) | 6 | 177 | 124 | 51 (222, 3,606) | 0 | 5,625 | 1,117 |
| a signal | 2 | 41 | 41 | 0 | 0 | 0 | 0 |
| a step-down to newer hooks | 1 | 13 | 13 | 0 | 0 | 0 | 0 |
| open at c1 (20:20Z) | 2 | 106 | 89 | 0 | 18 (974) | 287 | 0 |
| all | 28 | 1,355 | 1,170 (86%) | 74 (311, 8,302) | 142 (3,329) | 11,686 | 2,906 |

- **What each drained for.** 22 for slow files only. 4 for slow files and 1 to 5 new failures' re-runs. 2 have no start note left. At c0 each drained worktree had 34 to 85 slow files queued: most of cezar's e2e files. Cezar's e2e `inputs` include `packages/cezar/src/**`, so one edit to src re-keys all of them. 34 of the 43 live cezar worktrees had e2e files queued. The fast work that ran was the edit's work and the re-runs: 17 tiers of 4 files in one drain (`c87f067f`). The backlog stayed paused, as 011-93 asks. *read from store, read in source code.*
- **Waiting.** Cezar sets `slow.maxParallel` 1. In the 9 reduced copies, 3 to 12 cezar worktrees showed `waiting for slot`, 1 to 5 of them with a consumer, and one worktree ran an e2e file in 6 of them. A draining daemon leaves no waiter mark and yields while another worktree's mark is fresh (`slow-tier.ts:234`, `:283`). While live sessions waited, a drain got the slot only between their files. The two drains that ran slow files got 18 and 5 files in 60 min. 19 "slot held for over a minute" notes fall inside drains. The coordinator's reading holds for 10 of the 17 bound drains: they ran nothing for 60 min. A drain that got the slot alone ran 51 and 68 files in its hour (14:33Z and 15:44Z, fewer live sessions). At the median e2e file time of 13 s (n 572), 84 files take about 19 min. *read from store, verified by experiment (the copies).*
- **CPU.** 23,424 recorded seconds is about 7,500 to 13,800 CPU-s. 1,170 waiting minutes at 0.64 CPU-s each add about 750 CPU-s. *inferred.*
- **Before 10-23.** Notes keep the newest 20 per worktree, and a removed worktree's notes go with it (`worktrees.ts` `remove`). No drain notes from 10-22 remain. So the 28 drains are one afternoon, not the whole period. *read from store, read in source code.*

## 2. Memory

`sample.py` read every Squeal daemon's PSS, RSS and CPU ticks, with its descendants', from `/proc` (`results/samples-1935Z-2020Z.jsonl.gz`). `memory.py` labels a daemon as draining from the reduced copy before each sample (`results/memory-1935Z-2020Z.txt`).

| | Draining | Live (a consumer) | Other |
| --- | --- | --- | --- |
| daemons per sample, mean | 5.0 (2 to 8) | 11.2 | 2.9 |
| daemon PSS, mean MiB | 1,759 (638 to 3,516) | 6,985 | 734 |
| test processes PSS, mean MiB | 83 (max 389) | 2,442 | 56 |
| CPU-s per minute, all daemons of the group | 7.2 | 86.1 | 4.2 |

- In total: 226 draining daemon-minutes, 82,890 MiB-minutes and 326 CPU-s. Of the CPU, 211 CPU-s is the one drain that ran e2e files, with up to 17 processes and 389 MiB. The 7 drains that only waited used 0.46 to 0.89 CPU-s a minute (mean 0.64) at 214 to 600 MiB each (medians 239 to 498). Host memory available: 21,685 to 29,311 MiB of 46,470. Drains held 15.3% of all Squeal MiB (daemons and tests). *verified by experiment.*
- Slow lane in the draining minutes: `waiting for slot` 202, `waiting for load` 14, running a file 10. *verified by experiment (the copies).*

## 3. Worth

- **Read later.** 2,906 of 11,686 drained results (24.9%) were read later. They come from 5 drains. Two were drains a session ended and its own worktree read on: 645 in `3a40e85f`, and 472 in `564fa151`, at keys another worktree holds. The other three were bound drains: 1,181 in `564fa151`'s second drain (1,132 at keys another worktree holds), 581 in `d5062258` (all at such keys) and 27 in `a243c6b5` (re-runs). No result of the other 23 drains was read: 8,780 results. That includes `c87f067f`'s 3,124 edit-work results. *read from store.* A `squeal status` read moves no `last_used_at` (011-84 1.2), so a human's or a coordinator's read is not counted.
- **Deleted with the worktree.** `20d1db55` drained 14:33Z to 15:33Z: 51 slow runs and 471 results, none read, none at a key another worktree holds. Its worktree went between the reduced copies of 19:35:50Z and 19:40:50Z, and c1 has neither the runs nor the results. In the 48 cezar and 118 squeal worker worktrees cezarion removed since 0.1.253, the store holds no run that started after the task's finish (`removals.py`). So what drains there stored is deleted, and how much is not determined. *read from store, inferred.*
- **Under 011-160's 7 days.** The 471 would stay 7 days. 0 of them sit at a key another live worktree holds now, so none would be read by that measure. Of the 11,215 results still in live worktrees, 2,185 sit at a key another live worktree holds. *read from store, inferred (a key held now as a lookup within 7 days).*

## 4. Who drains

- All 28 drains are cezar worker worktrees (`.ai/cezar/worktrees/*`). At c0, cezarion listed the tasks of 20 of them as 15 `done` workers, 3 `done` roots and 2 `waiting` roots. No main checkout drained, and nothing in squeal or toolkit-dev. Squeal departures since 0.1.253 exited at the 3 s grace 38 times. Squeal sets no `slow.include` (default `[]`, `policy.ts:277`), so it drains only for owed work. *read from store.*
- **Departure to removal.** The drained worktrees stay: 23 of 24 still existed at 20:20Z, 43 to 276 min after their departure. The one removed went about 300 min after it. The workers cezarion removes go fast: cezar median 1.4 min after the task's finish (p10 0.0, p25 0.4, p75 8.2, p90 15.1; 43 of 48 within 15 min); squeal median 6.2 min (p75 46.8, p90 129.6; 71 of 118 within 15 min). Two groups, then: workers removed within minutes, whose drains the removal ends and whose notes are gone, and workers left for review, which drain the whole hour. *read from store; the finish as departure inferred.*

## 5. Options

`options.py` replays each drain with a known end (25 drains, 1,312 min). MiB-minutes count the measured 350 MiB for every daemon-minute, tests left out, so they are a lower bound. CPU counts 0.64 CPU-s a waiting minute plus the recorded seconds of runs not run. Lost results are results of runs the option does not run. Output: `results/options.txt`.

| Option (gap 60 s) | Daemon-min saved | MiB-min saved | CPU-s saved | Results lost | of them read later | at a key another worktree holds |
| --- | --- | --- | --- | --- | --- | --- |
| (a) exit when the drain must wait (any gap of 60 s with no run) | 1,226 (93%) | 429,085 | 3,243 to 5,318 | 3,320 | 1,762 | 1,713 |
| (a′) as (a), but the fast work (edit, re-runs) always runs | 1,139 (87%) | 398,482 | 1,756 to 2,623 | 1,364 | 581 | 581 |
| (b) a 15-minute bound | 947 (72%) | 331,408 | 4,028 to 6,915 | 4,391 | 435 | 435 |
| (c) no drains | 1,311 (100%) | 458,792 | 7,366 to 12,873 | 8,946 | 1,789 | 1,713 |
| (d) as today | 0 | 0 | 0 | 0 | 0 | 0 |

- **Sensitivity.** The lost read results come from 3 drains (`564fa151`, `d5062258`, `a243c6b5`), so they move with the model's gap. `d5062258`'s first slow file started 64 s after the departure. At a 120 s gap, (a′) loses 286 read results, not 581, and (a) loses 1,467. At 30 s, (a) loses the same 1,762 but saves 1,277 min. (b) and (c) do not depend on the gap. *verified by replay (model).*
- **What "lost" means.** The work stays queued in the rows, and the next daemon in the worktree queues it again (011-33). Another worktree at the same key runs it itself, or under cezar's `lookup-only` reads it stale until its own run. 011-84's "a resumed session's own daemon queues the same work again" still holds. *read in source code (011-84 1.3).*
- **The tradeoff.** About 87% of drain time is waiting (section 1). Any option that ends a wait saves most of it: (a), (a′) and (c) save 1,139 to 1,311 of 1,312 min. Only (b) and (a′) keep the fast work. Under (a′) the results lost that a later lookup read are one drain's slow files, at a gap that decides whether that drain waited. *inferred.*

## Recommendation for Squeal

None: the brief asks for numbers, not design. For the decision: a draining cezar daemon spends 86% of its time waiting for the one slow permit. Ending a drain that must wait saves 87 to 93% of the drain time. Its cost is the slow results of the few drains that got the slot: 581 read results in this window, at one drain.

## Open questions

1. Drains before 10-23T14:33Z and drains in removed worktrees: not determined, because notes keep 20 per worktree and go with the worktree. A drain log, or notes kept by the prune, would measure them.
2. Who read the 2,906 results: not determined, because `last_used_at` records no reader. 2,185 sit at keys another worktree holds now (inferred reader).
3. Tests' memory in the options' MiB-minutes: left out. Only one drain ran tests while sampled (up to 389 MiB).
4. The task's finish as the departure: inferred. A worker's last session can end before cezarion marks the task done.
5. The one-hour sample saw 2 to 8 drains at once; the human's 9 at one time is outside it.

## Sources

- Store copies: `~/projects/{cezar,squeal,toolkit-dev}/.git/squeal/store.sqlite` with `-wal` and `-shm`, 19:32:47Z and 20:20:21Z; cezarion `~/projects/{cezar,squeal}/.ai/cezar/runs.db` with `-wal` and `-shm` beside each; run reports since 2026-10-22T04:00Z copied after each.
- `/proc/<pid>/{stat,cmdline,smaps_rollup}`, `/proc/loadavg`, `/proc/meminfo`, 19:35:52Z to 20:19:51Z.
- Source at `a6d2f6c61`: `src/core/daemon/lifecycle.ts` (`drainable` `:400`, departure check `:296` to `:321`, `countPresence` ends a drain with no note `:284`, unused check skips a drain `:266`), `src/core/scheduler/scheduler.ts` (`pauseBacklog` `:647`, `owedWork` `:669`), `src/core/scheduler/slow-tier.ts` (`draining` `:136`, yield `:234`, no mark `:283`), `src/core/notes.ts` (20 notes), `src/core/store/repos/worktrees.ts` (`remove`), `src/core/fs/git-layout.ts` (`worktreeIdFor`).
- `~/projects/cezar/squeal.config.json`: `slow.include` `packages/web/e2e/*.e2e.ts`, `slow.maxParallel` 1, `baseline.onStart` `lookup-only`, `daemon.idleExitMinutes` 60.
- `tasks/011-84/design.md` 1.2 and 1.3; `research/edit-load.md` 0 (CPU per recorded second).
- Probes: `probes/drains/` (README lists each script and the commands; `results/` holds the outputs quoted here).
