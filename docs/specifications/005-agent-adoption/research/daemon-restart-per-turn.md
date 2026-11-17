# 005-99: a task alone in its worktree restarts its daemon at every turn

Researcher of row 005-99 (task fb9aacb2), 2026-11-17, 06:40Z to 07:30Z. Brief: `daemon-restart-per-turn-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `status.md`, `tasks/005-95/notes.md`, `../011-core/research/daemon-memory.md`, `restart-baseline.md`, `daemon-idle-cpu.md`, `hand-runs-2026-11-16.md`. Source at `18d475a5f` (0.1.538); the live daemons ran the installed 0.1.531 bundle. Claude Code 2.1.321.

Data, read-only: Squawk run logs `~/projects/{cezar,squeal}/.ai/squawk/runs/*.ndjson` changed since 2026-11-14; the daemon logs `~/projects/{cezar,squeal}/.git/squeal/logs/` (they reach back to 2026-11-14 15:00Z, 2.6 days); Claude Code transcripts under `~/.claude/projects/`; the two stores opened `immutable=1`; `/proc` of live daemons. A passive watch of `/proc` ran 06:59Z to 07:19Z. No test, daemon or load was started. Probes: `probes/daemon-restart-per-turn/` (throwaway, README there).

**Load.** "Busy CPUs" is the number Squeal's pool logged within 120 s of a sample (24 CPUs). Resumes that started a daemon: cezar median 17.3, p90 23.3 (48 of 48 known); squeal median 13, p90 23 (61 of 101 known). The passive watch: load average 17 to 26.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Time from a turn's start to a usable daemon, with and without a kept one | A resume that has to start a daemon waits a median 58 s (cezar, n=48, p90 183 s) and 28 s (squeal, n=101, p90 142 s) for the `serving` line. With a completed SessionStart: 42 s and 19 s; with a killed one (row 005-98): 117 s and 120 s. With a daemon kept alive by another session (12 of 163 resumes): 0. The registration is listed after a restart (109 of 114). Once serving, a young daemon is not slower for an edit | verified by experiment (probes over the logs and the store) |
| 2 | How often | 151 of 163 Claude Code resumes in Squawk started a daemon (93%). 152 of 194 Claude Code and 97 of 108 Codex session ends with a serving daemon stopped it within 15 s. After a restart, 5 of 114 registrations said "not listed"; 7 of 149 resumes made an edit before `serving` | verified by experiment (probes over the logs and transcripts) |
| 3 | Memory of a live idle daemon, and idle time | After the idle last-resort GC: median 386 MiB (cezar, n=1,520) and 454 MiB (squeal, n=823), p90 659 and 897. Its runner host child holds another 210 to 1,537 MiB until it closes after `runner.hostIdleMinutes` (8 min on this 64 GiB host). The time from a session end to the run's next start: median 13.3 min, p25 4.3, p75 34, p90 124 (n=184) | verified by experiment (probes over the logs; `/proc`) |
| 4 | What a start repeats | A whole-store `quick_check`, the stat-cache reconcile, the environment reads, the runner's listing, closure resolution for misses, the lookup, and one commit that rewrites the state of every listed file (cezar: median 43,167 rows, store lock held 3.6 s in sum, p90 10.1 s). 8 to 30 CPU seconds per start (n=8) | read in source code; the counts and CPU verified by experiment (probes over the logs; passive `/proc` watch) |

## 1. Time to a usable daemon

`turns.mjs`: one row per `SessionStart` hook item in a Claude Code step, joined with the daemon log of the step's worktree. "Serving" is the line the daemon logs after its start scan, listing, keying and baseline lookup (`daemon.ts` `#run`, line 995). The heartbeat starts earlier, before `#run` (`#startTimers`, line 369), and is not logged; a hook reads it as "a daemon is starting" until then.

| Case | n | Median | p90 |
|---|---|---|---|
| cezar resume, hook completed | 25 | 42 s | 82 s |
| cezar resume, hook killed (005-98) | 23 | 117 s | 370 s |
| squeal resume, hook completed | 82 | 19 s | 63 s |
| squeal resume, hook killed | 19 | 120 s | 491 s |
| cezar first start of a worktree | 34 | 50 s | 128 s |
| squeal first start of a worktree | 80 | 34 s | 72 s |

A killed hook leaves the spawn to the first tool boundary (`tasks/005-95/notes.md`, case e67b2b14); that the gap explains its slower rows is inferred. 7 of the 8 cezar resumes with a live daemon also had their hook killed, so the kill is not only the start's cost.

**Listed.** Keys stay in `test_file_keys` across a restart, and `testFilesListed` reads them (`state/header.ts:109`, `header-part.ts:70`). Completed resume registrations that started a daemon were listed in 109 of 114; first starts were unlisted in 121 of 121.

**First result for an edit.** `edits.mjs`, task worktrees, time from a watch or interval revision to the first run at it or later:

| Daemon when the revision was recorded | cezar n, median | squeal n, median |
|---|---|---|
| starting (before `serving`) | 6, 45 s | 20, 48 s |
| serving for under 5 min | 62, 83 s | 217, 50 s |
| serving for 5 min or more | 410, 90 s | 520, 95 s |

A revision is rarely recorded while the daemon starts: the few that were came a median 1.3 to 1.6 s before `serving`. Edits made earlier go into the `start` revision. In task worktrees that happened 16 times in 2.6 days (8 per repository), and 14 of them were followed by a run within 10 min. Under `lookup-only` a start that does not resume a rest queues no reach of those changes (`bootstrap.ts:230-260`); a lookup hit stores no run, so the 2 without a run are not proof of a missed verdict. *Read in source code; the counts verified by experiment (probe over the store).*

## 2. How often, and what the agent sees

`ends.mjs`: after a Squawk session end with a serving daemon, the daemon stopped within 15 s in 152 of 194 Claude Code ends and 97 of 108 Codex ends; most of the rest drained slow files first. Codex is affected as much as Claude Code: Squawk closes both at each step. Reason in nearly every case: "no session registered for 3 s after its last one ended" (`lifecycle.ts:255`, `departureGraceMs`). *Verified by experiment (probe over the logs); the Codex cause inferred from Squawk's `session.ended` lines.*

`window.mjs`, 149 resumes with a transcript, from the start to `serving`, against the window of the same length after it:

| | Start window | Control window |
|---|---|---|
| Resumes with a tool call | 131 | 90 |
| Resumes with an edit (edits) | 7 (8) | 5 (6) |
| Resumes with a `squeal status --wait` or `run` | 8 | 11 |
| Resumes with a hand test run (commands) | 19 (45) | 17 (28) |

At a turn's start the agent reads; it rarely edits before the daemon serves. The SQUEAL texts in the start windows were 118 "registered at revision N" with the primer at a tool boundary (the 005-95 chain, fixed by 005-98), 19 "a daemon is validating again", 2 "no daemon is validating". *Verified by experiment (probe over transcripts).*

**All restarts, from the daemon logs alone** (`restarts.mjs`, 2.6 days). squeal's main checkout started 847 daemons; 727 came within 5 min of the previous stop. Its 2,069 Claude Code sessions since 2026-11-14 are all Squawk's `[cez-namer] Name this task.`, and 886 of the 887 since 2026-11-16 make no tool call. Each SessionStart registers and spawns a daemon. squeal task worktrees: 332 starts, 185 first in their log, 27 within 5 min of a stop, 35 within 15 min, 28 within 60 min. cezar task worktrees: 584 starts, 354 first, 18, 20 and 23. cezar's main checkout started 13 daemons. *Verified by experiment (probes over the logs and transcripts).*

## 3. Memory and idle time

Live daemons at 06:56Z (14, ages 4 to 21 min, `/proc/<pid>/smaps_rollup`): private 242 to 1,502 MiB, median 680; each has one `runner-host --runner vitest` child (cezar: up to 4), private 210 to 1,537 MiB. The idle figure is the line "no tier for 60 s: a last-resort GC took private memory from X to Y" (row 011-69): Y above, pause median 195 to 235 ms. The runner host closes after `runner.hostIdleMinutes`, by default `round(RAM / 8 GiB)` clamped to 2 to 10 (`host-idle.ts:24`). An idle daemon spends 0.6 to 2% of a core after its first 2 minutes (`../011-core/research/daemon-idle-cpu.md` 3).

Today no daemon stays idle after its sessions leave: it exits after 3 s. The gaps a kept daemon would bridge are in the table of section 5.

## 4. What a start repeats

Read in source code at `18d475a5f`:

1. `PRAGMA quick_check` on the whole store at open (`daemon/open.ts:66`, `store/open.ts:208`). 011-313 measured 8.0 GB and 2.0 M reads before serving on a copy of cezar's store. The stores are 4.9 GB (cezar) and 4.0 GB (squeal).
2. The stat cache: cached paths reconciled, other git-known files hashed (`keys.bootstrap`, `scan`).
3. Environment reads and the runner's listing (`baseline`, `listTestFilesOf`). A failed listing already falls back to the stored keys (`bootstrap.ts:137`). The listing call is 65 to 330 ms (`daemon-memory.md` 3).
4. Keys from stored closures; a file that misses is re-resolved by the runner and looked up again (`resolveClosures`). 513 of 597 cezar starts and 237 of 1,178 squeal starts logged a closure write of 250 ms or more before `serving` (median 1,831 and 1,706 rows).
5. Under `lookup-only` the first commit writes every listed file's state (`commitFirst`): median 43,167 rows (cezar, 579 starts) and 26,026 rows (squeal, 330 starts with a long write). Cezar's start held the shared store's write lock 3.6 s in sum (median, p90 10.1 s), which other worktrees wait for.
6. Lost state: a parked registration keeps `scanned` only when the same daemon is live (`registered.ts:202`), and the Vitest module graph starts cold.

CPU per start, passive watch 06:59Z to 07:19Z (`start-cpu.mjs`, load average 17 to 26), CPU seconds of the daemon process alone at its `serving` line:

| Start | n | To `serving` | CPU | Private at `serving` |
|---|---|---|---|---|
| squeal main checkout (naming sessions) | 5 | 13 to 31 s | 8 to 15 s | 184 to 227 MiB |
| squeal task worktree, first start | 1 | 71 s | 30 s | 725 MiB |
| squeal task worktree, restart | 2 | about 39 and 68 s | about 16 and 25 s | 439 and 812 MiB |

Too few for a distribution. Two of the five main-checkout daemons stopped 0 and 1 s after `serving`: their session had ended.

## 5. Options

| Option | Effect on 1 and 2 | Memory cost | Outside Squawk |
|---|---|---|---|
| A. Keep the daemon K min after the last session leaves | Restarts avoided, of 184 Squawk resumes: K=2: 23; 5: 51; 8: 69; 15: 99; 30: 133. squeal main: about 727 of 847 at K=5. Each avoided start saves its 19 to 58 s and 8 to 30 CPU s, the `quick_check` and the full commit. The agent gains little: 7 of 149 resumes edited in that window | Kept at once (Squawk ends, main checkouts not counted): K=2 mean 0.21, max 6; K=5 0.51, max 8; K=8 0.79, max 10; K=15 1.41, max 14. Each about 0.4 GiB after GC, plus its runner host until that closes. K=8: mean about 0.3 to 0.8 GiB, peaks of 4 to 9.5 GiB | Interactive Claude Code ends its session only at exit: a kept daemon then costs K min per exit. One-shot `claude -p` users gain as Squawk does. A K from the machine exists: `runner.hostIdleMinutes`'s formula, 8 min here |
| B. Keep it only while a session is parked for a resume | Squeal cannot see "parked". Claude Code's SessionEnd `reason` is `clear`, `resume`, `logout`, `prompt_input_exit` or `other` (hooks docs); no value marks a close that a resume will follow. Squeal's own parked registration lives 12 h (`CONSUMER_EXPIRY_MS`): keeping the daemon that long avoids 180 of 184 restarts at a mean of 37.7 kept daemons, 143 at most (an upper bound: a removed worktree stops its daemon; K=60 alone: mean 4.70, max 33) | Against the human's rule of 2026-11-12 | Needs a signal from the harness, a contract outside Squeal |
| C. Reuse the last listing at start | Under 1 s of a 19 to 58 s start; the listed state already comes from the store (109 of 114). A first start has no listing of its own | none | none |

## Recommendation for Squeal

The restart costs the machine more than the agent. For the agent, the large cost is the killed SessionStart, which row 005-98 removes: 117 to 120 s against 19 to 42 s to `serving`. After that, about 1 resume in 20 edits before the daemon serves, and a young daemon is not slower. No keep-time row for the agent's sake.

For the machine, the largest share is not in task worktrees: 847 of 1,179 squeal daemon starts in 2.6 days were in the main checkout, and nearly all its sessions are Squawk's naming calls with no tool call. A row there is worth more than option A: Squawk's naming session without Squeal's plugin (Squawk's side, the cezar repository), or no spawn for a session that never reaches a tool boundary (Squeal's side; it crosses 005-98's "register first, then start the daemon"). The coordinator decides the owner.

Option A is the only one of the three with a large effect. The tradeoff that decides it is about 10 to 30 CPU s, one `quick_check` and a 26,000 to 43,000-row commit per avoided start, against about 0.4 GiB (more with a runner host) for K minutes, with up to 10 kept at once at K=8. Under the human's rule of 2026-11-12, it is worth a row only with the K from the machine (`runner.hostIdleMinutes`'s formula) and a kept daemon that closes its runner host at the departure. That is design, for the spec. Options B and C: no row.

**What this answers of 011-385.** Per-turn restarts do not explain the long "not listed" stretches: a resumed worktree registers listed (109 of 114), and "not listed" is a first-start state (121 of 121). A first start took a median 34 to 50 s to `serving` here, p90 72 to 128 s. The 18 to 110 min stretches of 011-385 are not reproduced in this window; reusing a listing does not help a worktree that has none.

## Open questions

1. Which SessionEnd `reason` a Squawk close produces: not determined, because no hook log records the input.
2. The time to the first heartbeat: not determined, because the daemon logs no line for it; read in source as before the start scan.
3. Whether the 16 `start` revisions in task worktrees missed a verdict under `lookup-only`: not determined, because a lookup hit stores no run.
4. Start CPU at n=8 only, and of squeal worktrees; cezar's starts are not sampled. The share of the `quick_check` in it is not measured here.
5. Removed worktrees' logs and runs are gone: the sample is the worktrees alive on 2026-11-17 plus Squawk logs since 2026-11-14.

## Sources

- Squeal source at `18d475a5f`: `src/core/daemon/lifecycle.ts` 185-345 (`startTimers`, departure), `daemon.ts` 343-375 and 940-996 (start, `serving`), `open.ts:66`, `src/core/store/open.ts:208`, `host-idle.ts:24`, `runner-idle.ts`, `src/core/scheduler/bootstrap.ts` 62-310 (`scan`, `baseline`, `commitFirst`), `src/core/state/header.ts:109`, `header-part.ts:70`, `src/core/delivery/registered.ts` 140-260 (`park`, `back`), `src/core/types/store-records.ts:303`, `src/harness/shared/session.ts`, `sweep.ts`, `plugins/claude-code/hooks/hooks.json`, `squeal.config.json` and `~/projects/cezar/squeal.config.json` (both `lookup-only`).
- Claude Code hooks reference, SessionEnd, fetched 2026-11-17: https://code.claude.com/docs/en/hooks (`reason` table; 1.5 s default budget).
- Logs and stores as listed at the top; probe outputs in the task's scratch directory, not kept.
- Earlier findings: `tasks/005-95/notes.md`; `../011-core/research/daemon-memory.md` 1, 3, 3b; `restart-baseline.md` 3; `daemon-idle-cpu.md` 2, 3; `hand-runs-2026-11-16.md` 1.
