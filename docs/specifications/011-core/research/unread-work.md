# Unread work: how much of Squeal's background test work produces results nobody reads

Researcher task a1d21d26, 2026-11-07, for the human's question in task 7d611fc4: can Squeal cut its background demand by skipping work whose results nobody reads? Data: the stores of squeal, cezar and toolkit-dev with their runs' `report.json` files, copied 2026-11-07 22:35Z; Cezar's task databases (`runs.db` of both projects) for worktree removal times; Claude Code, Codex and Pi transcripts from 2026-10-29 23:00Z to 22:40Z; sar `-u`. **Window:** runs that started from 2026-10-31 20:00Z to 2026-11-07 08:20Z (6.4 days, as `manual-mode.md`; the stores hold almost no runs before it, and sar after 08:20Z holds the human's CI test). Readers are looked for up to 22:40Z, 14 h after the window. Source read at `fc34e0894`. This worktree's daemon was stopped (`squeal stop --until-start`), and its runs and transcript are out of every count. No test, build or load was started. Probes: `probes/unread-work/` (README there).

**Units and n.** A record is one test file's module seconds in one ended run (`report.json`), as `load-slowdown.md`. Background = restart and start baselines plus backlog tiers: 655 file-hours (102 a day), 266,965 records, 35,321 runs, 592 worktrees (cezar 553 h, squeal 101 h, toolkit-dev 1 h). 39% of it (254 h) ran above 16 busy vCPUs. Readers are 10,017 agent sessions (Claude 9,274, Codex 699, Pi 44).

**Verdict.** Only **4.3%** of background file-seconds (28.4 h, 4.4 h a day) have no reader of any kind, and **6.0%** of the background work above 16 busy vCPUs (15 h). Nearly all of it is end-of-life work. It ran after the last session event in its worktree, and the worktree was removed before any session came back. A rule over sessions cannot isolate it well. A rule that pauses background work once every turn in the worktree has ended saves at most 3.1%, and it delays the 56% of background work that is read later by a median of 9 min (p95 118 min). The demand is in work that is read, mostly as silence: 57% of background seconds reached a session only through hook counts and the Stop check, 18% through a bare `squeal status --wait`, and 18% was reused by another worktree. A reader rule cannot cut the demand enough to replace a back-off.

## Questions answered

| # | Class | Share of background seconds (above 16 busy) | cezar / squeal | Of it, nobody read | Tag |
|---|---|---|---|---|---|
| 1 | No session: outside every session's first-to-last event | 4.3% (5.9%), 27.8 h | 4.6% / 2.3% | 69%; 22% other worktree, 9% a later session | inferred |
| 1b | No session event for 30 min (sessions idle included) | 14.9% (15.1%), 97.7 h | 16.8% / 4.8% | 20%; 74% read later (p50 63 min) | inferred |
| 2 | Worktree removed within 1 / 6 / 24 h of the run | 17.5 / 48.5 / 58.3% (19.3 / 50.8 / 60.4%) | — | 7.8 / 5.1 / 4.7% | verified by experiment (removal times); readers inferred |
| 3 | Same file ran again in the worktree before any session event | 0.3% (0.3%), 1.7 h | — | 100% by definition | inferred |
| 3b | Same file ran again within 5 / 30 min (read or not) | 1.6 / 9.3% (1.4 / 7.1%) | — | — | verified by experiment |
| 4 | **Read by nobody at all** | **4.3% (6.0%), 28.4 h** | **4.5% / 3.5%** | — | inferred |

## Method

- **Root.** Squeal's worktree id is the first 16 hex characters of sha256 over the root's real path (`worktreeIdOfRealPath`, `src/core/fs/git-layout.ts`, `read in source code`). The stores had pruned most worktree rows (82 left). Hashing every root that the transcripts, the task databases and the main checkouts name maps 100% of background seconds to a root. `verified by experiment`
- **What the store does not record.** It does not record who read a result. `consumers` and `consumer_views` rows are deleted when a session unregisters (`src/core/store/repos/consumers.ts`). `results.last_used_at` is set by every lookup, and the producing daemon's own `refresh` sets it seconds after the store (`src/core/state/sink.ts`, `scheduler/accept.ts`). So it cannot tell another worktree from the producer. `read in source code`; a sample showed `last_used_at` 10 s after `recorded_at` in the producer. `verified by experiment`
- **Proxies** (`classify.py`, all `inferred`):
  - Read in its worktree: a session event (any tool call, prompt or Stop) in the root after the run ends and before the same file runs again there or the worktree is removed. Each event delivers Squeal's hook state.
  - Read by another worktree: the result row survives, and another worktree holds its key now (`test_file_keys`), or its `last_used_at` is more than 120 s after the producer's last activity.
  - Removal: Cezar's destroy request time. Where the task row is gone and the path is gone, the time is unknown.
- **Explicit readers** (`explicit.py`): a `status --wait` or `run` naming the file or a folder above it; a SQUEAL message whose FAIL lines name the file; another worktree; a bare `status --wait` (no path, or `--all`). The rest is "silence".

## Findings

**1. No session.** `inferred`. 27.8 h (4.3%) ran outside every session's span. All of it started 0 to 60 min after the root's last session event: 21% within 3 min, 30% at 3 to 10 min, 38% at 10 to 30 min and 11% at 30 to 60 min (`after-last.py`). That fits a session that is still registered but idle until `daemon.unusedExitMinutes` stops the daemon. It also fits a drain bounded by `idleExitMinutes` (60 in cezar's config). The source drains only slow files and owed work after a departure (`drainable`, `daemon/lifecycle.ts`, `read in source code`). The store keeps no consumer history, so the two cannot be told apart. Baselines hold 6.0% of their seconds here, the backlog 2.8%. Before Pi transcripts were read, 16.8 h of backlog in 25 cezar tasks looked like work with no session at all. All 25 have Pi sessions, and they are counted now.

**2. Deleted soon after.** 474 of 592 worktrees with background work were removed in or after the window. Removal follows work fast: 17.5% of background seconds ran within 1 h of their worktree's removal and 48.5% within 6 h. Most of it was read before the removal: 86% of the 1 h share had a later session event in its worktree. `verified by experiment` for times; `inferred` for reads.

**3. Superseded before read.** Within an active session, the next hook event comes before the next run of the same file, so only 0.3% of background seconds were replaced before any event. Intermediate keys do run: 1.6% of background seconds re-ran the same file within 5 min, and 9.3% within 30 min. They were read between the runs. A rule that skips them saves seconds only if "read" means an explicit read (finding 4).

**4. Readers of every background second.** `inferred` (`explicit.py`):

| Reader | All | cezar | squeal | Above 16 busy | First failures (per 100 h) |
|---|---|---|---|---|---|
| Asked by path (`status --wait <path>`, `run`) | 2.4% | 0.6% | 12.5% | 2.7% | 95 (598) |
| FAIL line in a SQUEAL message | 0.3% | 0.3% | 0.3% | 0.3% | 303 |
| Another worktree used it | 17.8% | 18.0% | 16.7% | 14.2% | 4 (3) |
| A bare `status --wait` | 18.3% | 20.1% | 8.3% | 19.9% | 50 (42) |
| Silence only: a later hook event, Stop | 56.8% | 56.4% | 58.5% | 56.8% | 419 (113) |
| **Nobody** | **4.3%** | **4.5%** | **3.5%** | **6.0%** | **54 (190)** |

Class 4 by what came first: removal 60%, a removal with no recorded time (task row deleted, path gone) 34%, another run of the same file 6%. 67% of it is also class 1. The 419 first failures under "silence" reached a session through hook counts or a FAIL format that the probe does not parse. So "silence" is not only passes.

**5. What a skip or defer rule costs.** `inferred` replays on the records (`curve.py`, `turn.py`). "Saved" = held work that nobody read later. "Moved" = held work that is read later, delayed until the next session event. "First failures" = a file's first fail in its worktree (925 in background work).

| Rule: hold background work while… | Held | Saved (above 16) | Moved, delay p50 / p95 | First failures held: read later (delay p50 / p95 / max) / never read |
|---|---|---|---|---|
| no session event for 3 min | 47.0% | 2.8% (4.1%) | 43.4%, 7.8 / 107 min | 129 (3.9 / 34 / 255 min) / 9 |
| no session event for 10 min | 19.4% | 1.8% (2.7%) | 17.1%, 8.6 / 118 min | 21 (5.0 / 22 / 255) / 8 |
| every session's last event is its Stop | 59.6% | 3.1% (4.8%) | 55.5%, 9.1 / 118 min | 96 (5.4 / 34 / 585) / 39 |
| … and that Stop is 3 min old | 40.6% | 2.6% (4.1%) | 37.2%, 9.7 / 143 min | 76 (5.2 / 34 / 255) / 9 |
| … and that Stop is 30 min old | 2.1% | 0.3% (0.4%) | 1.7%, 49 / 288 min | 4 / 0 |
| an oracle that knows nobody will read it | 4.3% | 4.3% (6.0%) | 0 | 0 / 54 |

- Background work runs mostly between turns: 60% of its seconds ran while every session in the worktree had ended its turn. The agent reads it at its next turn.
- Work that another worktree used is not saved by a skip. That worktree would run it itself (1.0% under the Stop rule).

## Recommendation for Squeal (proposals only)

All rules below use sessions, turns and task ends, not core counts.

1. **Do not expect a reader rule to replace the back-off.** The ceiling is 4.3% of background seconds and 6.0% above the knee: about 2.4 file-hours a day above 16 busy, against 40 now. A real rule reaches 2 to 3%, and it delays the background results that are read by the same order the human rejected (p95 about 2 h).
2. **If anything, stop background work when a worktree's task ends, not at a turn's end.** The unread work is the last 0 to 60 min of a worktree's life. A harness that removes worktrees (Cezar destroy, a `git worktree remove` hook) or that ends a session for good should call `squeal stop` first. Squeal should then drop the backlog and the baseline remainder without a drain. The cost is the 54 first failures that nobody read anyway, plus 1.0% of work another worktree would run itself. This needs a task-end signal. Squeal alone cannot tell a session's last turn from a pause.
3. **The demand is in work read as silence (57%) and bare waits (18%).** Cutting it changes what Squeal promises (every file checked in the background), so it is a product decision, not a reader rule. Silence-only work found 113 first failures per 100 h and asked-by-path work 598 (finding 4). The next research topic would be the value per class.

## Open questions

- Not determined: whether a session was registered with the daemon during class 1. Consumer rows are deleted at unregister, and the daemon's notes keep only the last 20 per worktree. A daemon log line per registration and departure would settle it.
- Not determined: reads through `last_used_at` of result rows that were replaced or pruned later (1.1% of background seconds have no row). The cross-worktree figure is a current-holder and after-departure lower bound.
- Not determined: whether a session's hook event shows a pass. The proxy counts every later event as a read. With only Stop, waits and FAIL messages counted, 7.1% is unread (8.2% above 16 busy). Pi records no Stop, so that variant overcounts Pi.
- `manual-mode/sessions.py` parses FAIL lines with one space after `FAIL`. Today's hook writes two (`FAIL  [e2e] path`), and the matches it found in a sample were complexity and untested lines. This probe's copy fixes it. `manual-mode.md` finding 4's failure counts may be low for this reason.
- The 1 OpenCode task in cezar has no transcript reader. The Pi reader treats every message as activity, because Pi records no Stop.

## Sources

- Stores and run reports: `~/projects/{squeal,cezar,toolkit-dev}/.git/squeal/` (`store.sqlite` with `-wal`/`-shm`, `runs/*/report.json`), copied 2026-11-07 22:35Z, read with `node:sqlite` read-only (`probes/unread-work/extract.mjs`).
- Cezar task databases: `~/projects/{squeal,cezar}/.ai/cezar/runs.db` copies (fields `worktree_path`, `delegation.destroy.requestedAt`, `finished_at`), `removals.mjs`.
- Transcripts: `~/.claude/projects/*/*.jsonl` with `subagents/`, `~/.codex/sessions/2026/*/*/*.jsonl`, `~/.pi/agent/sessions/*/*.jsonl`; paths, times and FAIL file names only.
- sar: `/var/log/sysstat/sa[0-9][0-9]`, `sadf -d -U … -- -u`.
- Source at `fc34e0894`: `src/core/fs/git-layout.ts`, `src/core/store/schema.ts`, `store/repos/consumers.ts`, `store/repos/results.ts`, `state/sink.ts`, `scheduler/accept.ts`, `scheduler/scheduler.ts` (`inUse`, `owedWork`), `daemon/lifecycle.ts` (`startTimers`, `drainable`).
- Earlier results: `load-slowdown.md` (knee, units), `manual-mode.md` (window, `sessions.py`), `restart-baseline.md`, `background-backoff.md`.
