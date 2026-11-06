# 011-300: a main-checkout daemon, with today's numbers

Researcher of row 011-300, 2026-11-05 23:40Z to 2026-11-06 00:40Z (Europe/Warsaw 00:40 to 01:40). Brief: `research/main-daemon-2-brief.md`. Read: `research/main-daemon.md` (011-157) and its brief and probes, `research/new-worktree-baseline.md` (011-299) section 4 and probes, `research/restart-baseline.md`, `research/main-pull-checkpoint.md`, `research/main-pull-reuse.md`, `research/daemon-memory.md`, `019-run-triggers/research/load-split.md`; `src/core/scheduler/claims.ts` (`claimOf`, `peekClaim`) at `75173271d`.

Data: copies of cezar's and squeal's stores (`store.sqlite` with `-wal` and `-shm`), taken 2026-11-05T23:47Z. Window as 011-299: 72 h to 2026-11-05T16:50Z. cezar's and squeal's git repositories and their `origin/main` reflogs, read only. No daemon was started, no test ran. Load1 while the probes ran: 9 to 21 (24 CPUs). Probes and re-run steps: `probes/main-daemon-2/README.md`; outputs in `probes/main-daemon-2/results/`.

**Units and method.** *Seconds* are recorded seconds: per-file durations from `report.json`. A main daemon's cost per file is the file's median recorded duration in the window. One recorded second cost 0.32 to 0.59 CPU-s (`edit-load.md` finding 0; not re-measured). *Equal content* is 011-157's signature (`../main-daemon/sig.mjs`, reused): the file's stored closure, observed set and declared inputs as git blobs at a commit, plus every Vitest config and the root lockfile (the stricter *env* variant; the looser one is in `results/report-*-noenv.txt` and moves no conclusion). A main commit *lands* when the host's `origin/main` reflog first reaches it (a fetch or push in any checkout): no worktree can start there earlier.

**The simulated daemon.** It starts current at the window's first commit. At each target commit it queues every file whose content it has not finished, skipping a file any worktree had stored clean at equal content (it runs `lookup-then-run-missing`). It looks up again before each file, as tier selection does (`claims.ts` `peekClaim`: "a result stored at its key stands for it, which it takes with no run"; *read in source code*). It runs one queue at R recorded s per wall minute; a new target replaces the queue. R: cezar's one `run --all` in the window did 90 s/min (10,461 s in 116 min); cezar baselines that ran at least 1,000 s did 70 at the median and 178 at p90 (`rate.cjs`). I use 70, 90 and 180 for cezar; 60, 90 and 140 for squeal (011-157's range). A worktree file run is *spared* when the daemon had finished that file at the run's committed content before the run started. A run at a dirty revision is compared by its commit, so its "spared" is an upper bound: in 011-299, own edits touched the closure in 90% of such seconds.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Cost | cezar: 165 main commits re-key 708,124 s together (p50 2,595 s, p90 10,532 s, max 13,182 s per commit; the suite is about 17,000 s). After lookups and supersession, a daemon that validates every commit runs 246,000 to 470,000 s in 72 h (R 70 to 180). It never catches up at R 90 or less. Every 8th commit: 146,000 to 159,000 s. After 30 quiet minutes: 160,000 to 237,000 s. After 60 quiet minutes: 50,000 to 54,000 s. squeal: 351 commits, 190 re-key nothing; every commit: 27,500 to 46,900 s | read from store copies and git; simulated |
| 2 | Saving | cezar at R 90, every commit: it spares 112,377 s of worktree runs at clean revisions, 197,201 s if every dirty run counts too, against 300,602 s run. First baselines: 71,576 of 214,819 s (33%); restart baselines: 50,752 of 372,338 s (14%). 124,507 s (41%) of what it runs no worktree runs later; 39,237 s (13%) a worktree ran first. No policy and no rate spares as much as it runs. squeal: it spares 7,600 to 11,700 s (13,000 to 19,000 with dirty runs) against 29,000 to 47,000 s | read from store copies; simulated |
| 3 | Waiting | cezar first baselines at R 90: 20% of the seconds they listed as misses would be current at start (per baseline p50 19%, p90 97%); 16 of 247 would start with no miss (today 0). Mean wait per file that ran: p50 5.5 to 3.6 min, p90 33.3 to 33.1 min. The covered files are current earlier by p50 5 min, p90 43 min. The whole baseline's ended files: p50 0 min earlier, p90 5 to 15 min (R 180: p90 13 to 21 min). squeal (`lookup-only`): not determined, start commits not recoverable; its 11 first baselines listed 147 misses | read from store copies; simulated; the whole-baseline gain inferred |
| 4 | Compare with 011-157 | Cost rose 8 to 14 times (30,000 to 35,000 s then; 246,000 to 470,000 s now), saving from about nothing to 37 to 66% of the cost. Still a net loss: about −100,000 to −190,000 s at R 90. The assumptions that changed: the daemon follows origin/main, not a hand-pulled checkout; cezar's worktrees now run their misses; cezar's suite and main traffic grew | table in section 4 |

## 1. Cost

`md2.mjs`, `report.cjs` (`results/report-cezar-env.txt`, `results/cezar-env-percommit.jsonl`).

| cezar, 72 h | |
|---|---|
| Main commits landed; distinct landing moments | 165; 158 (squash merges, no merge commits) |
| Landing after the commit time | p50 22.9 min, p90 172 min |
| Gap between landings | p50 16.4 min, p90 50.2 min |
| Files re-keyed per commit | p50 138, p90 774 of 1,648; 12 commits re-key nothing |
| Recorded s re-keyed per commit | p50 2,595, p90 10,532, max 13,182; 708,124 in all; 44,441 of it already stored at equal content when the commit landed |
| Suite, sum of medians | 1,738 files with a duration, 17,040 s; 279 files ran no file to the end in the window and count 0 s (the cost is low by that much) |

What the daemon runs, by policy (recorded s; `results/report-cezar-env.txt`):

| Policy | Targets | R 70 | R 90 | R 180 | CPU-s at R 90 |
|---|---|---|---|---|---|
| Every main commit | 165 | 245,970 | 300,602 | 469,824 | 96,000 to 177,000 (0.4 to 0.7 cores) |
| Every 2nd | 83 | 238,976 | 287,486 | 400,447 | |
| Every 4th | 42 | 209,843 | 239,867 | 287,300 | |
| Every 8th | 21 | 145,727 | 149,630 | 158,844 | |
| After 10 min with no newer commit | 145 | 241,812 | 294,746 | 454,220 | |
| After 30 min with no newer commit | 41 | 159,998 | 181,865 | 236,745 | |
| After 60 min with no newer commit | 10 | 49,805 | 50,765 | 53,755 | |

- **It does not keep up.** At R 70 and R 90, every policy except "every 8th" and "60 quiet minutes" keeps the daemon busy to the window's end (`busyUntil`, `results/cezar-env-sim.json`). The capacity of 72 h at R 90 is 388,800 s; the re-keyed content is 708,124 s. What it runs is set by the rate, and later commits supersede the rest (316,392 s at R 90). *Simulated.*
- **Lookups help less than in 011-157.** When a commit landed, 6% of its re-keyed seconds were already stored at equal content (011-157: 5,337 of 35,348 s, 15%). By the time the daemon reached a file, more had been stored: 322,530 s skipped at R 90. Squash merges combine branch changes no single worktree ran together (011-299 section 2), so most of a commit's re-keyed files are new content. *Read from store copies.*
- **squeal.** 351 commits land at 94 moments (pushes carry several commits); 190 commits re-key nothing (docs). Every commit: 42,977 to 46,930 s (env), 27,516 to 31,427 s (no env); quiet 60 min: 17,600 to 33,200 s. *Simulated (`results/report-squeal-*.txt`).*

## 2. Saving

cezar, recorded s, 72 h. Spared = clean / dirty runs (dirty is an upper bound). Worktree file runs judged: first baselines 214,819 s, restart baselines 372,338 s, other runs 408,962 s (clean 495,341 of 996,119).

| Policy, R | Main runs | First baselines spared | Restart baselines spared | Other runs spared | All spared: clean; with dirty | Main runs no worktree needed | A worktree ran it first |
|---|---|---|---|---|---|---|---|
| Every commit, 70 | 245,970 | 34,129 / 24,865 | 25,528 / 13,811 | 31,271 / 29,438 | 90,928; 159,096 | 96,652 | 38,285 |
| Every commit, 90 | 300,602 | 41,156 / 30,420 | 32,910 / 17,842 | 38,311 / 36,508 | **112,377; 197,201** | 124,507 | 39,237 |
| Every commit, 180 | 469,824 | 61,657 / 43,418 | 44,426 / 29,524 | 53,874 / 48,282 | 159,957; 281,242 | 236,997 | 35,152 |
| Every 8th, 90 | 149,630 | 12,137 / 10,311 | 8,995 / 4,791 | 11,186 / 13,054 | 32,318; 60,474 | 74,023 | 32,920 |
| 30 quiet min, 90 | 181,865 | 15,349 / 11,422 | 15,713 / 3,961 | 9,763 / 14,375 | 40,825; 70,637 | 81,518 | 48,557 |
| 60 quiet min, 90 | 50,765 | 5,853 / 2,493 | 2,225 / 136 | 2,501 / 3,097 | 10,579; 16,305 | 28,506 | 10,945 |

- **The ratio stays below one.** Spared over run, over all 21 policy and rate pairs: 0.21 to 0.37 counting clean runs, 0.29 to 0.66 counting every dirty run as spared. With 011-299's 90% own-edit rate for dirty seconds, the realistic figure is near the clean one: every commit at R 90 spares about 121,000 s for 300,602 s run. A higher rate spares more and runs more in about the same ratio. *Simulated; the dirty correction inferred from 011-299.*
- **Cross-check with 011-299.** Its bound was 52% of first-baseline seconds at content of a main commit that had landed 30 min before. Here a rate-limited daemon spares 33% (R 90) to 49% (R 180), with dirty runs counted. The gap is the rate and the later landing time (reflog, not commit time). *Simulated.*
- **What it runs for nothing.** 41% (R 90) to 50% (R 180) of the daemon's seconds have content no worktree ran after it finished, in the window. Some is content a worktree would need after 16:50Z; the window cuts it. *Simulated.*
- **squeal.** Its worktrees run `lookup-only`, so there are no baseline runs to spare; the spared seconds are pull and edit catch-up. Every commit, R 90: 9,266 s clean, 15,561 s with dirty, against 44,871 s run; 27,827 s (62%) no worktree needed. *Simulated.*

## 3. Waiting

cezar first baselines (247; `results/cezar-env-wait-90.jsonl`, `results/cezar-env-start-90.jsonl`). A file counts as covered only when its run was at a clean revision.

| At the start, listed misses the daemon had finished | R 70 | R 90 | R 180 |
|---|---|---|---|
| Share of listed-miss seconds (1,269,494 s, 78,458 files) | 15.7% | 20.0% | 33.7% |
| Per baseline, p50 / p90 | 13% / 90% | 19% / 97% | 41% / 100% |
| Baselines with no miss left (today 0 of 247) | 14 | 16 | 51 |

| Time to current, minutes after the baseline starts | Today | R 90 | R 180 |
|---|---|---|---|
| Mean per ended file, p50 / p90 | 5.5 / 33.3 | 3.6 / 33.1 | 2.9 / 32.1 |
| Covered files, how much earlier, p50 / p90 (baselines with one: 131 at R 90) | | 5 / 43 | 5 / 43 |
| Last ended file, p50 / p90 | 10 / 69 | 5 to 7 / 62 to 66 | 4 to 5 / 52 to 62 |
| Last ended file, how much earlier, p50 / p90 | | 0 / 5 to 15 | 0 to 1 / 13 to 21 |

The ranges keep the uncovered files at today's times (no gain from the freed slots), or scale today's time by the uncovered share of seconds. 230 of 247 first baselines ended `abandoned` (011-299), so "last ended file" is not "all tests current": most listed misses never ran in the baseline. Start commits come from each worktree's earliest stored row (no revision of a removed worktree survives), an approximation. *Read from store copies; simulated; the ranges inferred.*

squeal: its 11 first baselines in the window listed 147 misses (3,359 s), 137 of them in one; 9 of 11 start commits are not recoverable. Not determined.

## 4. Compared with 011-157 (2026-10-23)

| Row | 011-157, cezar | Now, cezar | What changed |
|---|---|---|---|
| What the daemon follows | the main checkout's HEAD: 12 hand pulls in 72 h | origin/main: 165 commits, 158 landings | **assumption**: the brief now asks for origin/main after each pull; a pull batches commits, per-commit validation does not |
| Worktree start | `lookup-only` | `lookup-then-run-missing` (2026-10-27) | **assumption**: misses now run, so there is work to spare |
| What first starts miss | 21,246 s at 13 starts | 214,819 s run by 247 first baselines; 1,269,494 s listed | 10 times the seconds, 19 times the starts (load-split: 5 times the worktree-hours) |
| Suite | 997 files, 4,645 s | 1,648 files at the tip, about 17,000 s | 3.7 times the seconds |
| Re-key per move | 3,661 s per pull (p50) | 2,595 s per commit (p50), 10,532 (p90) | smaller moves, 14 times as many |
| Rate | 60 to 140 s/min | 70 to 180 s/min (90 measured) | about the same |
| Cost, 72 h | 30,000 to 35,000 s | 245,970 to 469,824 s every commit; 50,765 at 60 quiet min | 8 to 14 times |
| Against the default | −9,000 to −14,000 s | every commit, R 90: 112,377 to 197,201 s spared, 300,602 run: −103,000 to −188,000 s | saving grew from about 0; cost grew more |
| Starts that keep a miss | 9 to 13 of 13 | 231 of 247 at R 90; 196 of 247 at R 180 | |
| Idle CPU, memory; lifetime | 0.8 CPU-s/min, 300 to 320 MiB; nothing keeps a main daemon up | not re-measured; at R 90 or less the daemon is never idle. Lifetime code changed in 18 commits since and was not re-read | |

squeal, the same rows: 100 hand moves then, 351 commits (94 landings) now; cost 77,000 to 92,000 s then, 29,000 to 47,000 s now; misses 72,402 s then, and now no baseline runs (`lookup-only`), with 7,600 to 11,700 s of catch-up spared. The cost fell because most squeal commits are documentation and its worktrees had stored most code content first (513,529 s skipped at R 90). Its main checkout now has `node_modules` (011-157: none). *Read from store copies, git and disk; simulated.*

## Recommendation for Squeal

Do not build it on these numbers. The tradeoff is the same as on 2026-10-23, at a larger scale: cezar's main commits re-key 1.8 times what one daemon can run in the window at 90 s per minute, and what it does run spares worktrees 0.37 of its seconds (0.66 if every dirty run counted). Waiting improves a little: a fifth of a new worktree's listed misses are current at start, the median baseline's mean wait per file falls by 2 minutes, and the p90 baseline barely moves. Validating less often (every 8th commit, 60 quiet minutes) cuts the cost, but the saving falls in step. The work a new worktree runs is mostly content that only it, or the merge it starts on, has: a main daemon moves part of it and adds content nobody needs.

## Open questions

1. The rate beside the host's other daemons: R is from one `run --all` and from baselines on a loaded host. A main daemon would take slots from worktree daemons; that cost is not modelled.
2. Dirty runs: 50% of judged seconds; their content is unknown for removed worktrees, so their spared share is bounded, not measured (011-299 open question 1).
3. Content needed after the window: the 41% "no worktree needed" includes files a worktree would run after 16:50Z. A longer window would show how much.
4. squeal's start verdict: not determined, because 9 of 11 first baselines have no recoverable start commit.
5. Key components outside the signature (the observed set's history, Node version, untracked files): the env and no-env variants bracket the configs and lockfile only (011-299 class (c), 3.7%).

## Sources

- Store copies: `~/projects/{cezar,squeal}/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-11-05T23:47Z; `runs/<id>/report.json` read in place.
- Git: `rev-list --first-parent origin/main`, `ls-tree -r`, and `logs/refs/remotes/origin/main` of both repositories; cezar origin/main at `9f0941b84` and squeal at `dde59cf8c` when read. `~/projects/{cezar,squeal}/squeal.config.json` for declared inputs.
- Source at `75173271d`: `src/core/scheduler/claims.ts` (`claimOf`, `peekClaim`).
- `ps` and `/proc/<pid>/cwd` of the host's daemons, read only (no main-checkout daemon idle figure taken).
- Earlier research: `main-daemon.md` and `probes/main-daemon/sig.mjs`, `new-worktree-baseline.md` section 4, `restart-baseline.md`, `019-run-triggers/research/load-split.md`, `edit-load.md` finding 0.
- Probes: `probes/main-daemon-2/` (README lists each script and the commands; `results/` holds the outputs quoted here).
