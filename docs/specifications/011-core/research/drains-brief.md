# Research brief 011-161: what departure drains do since 011-93

Use /researcher. Shape: research. Outcome: the numbers the human needs to decide what a draining daemon does when it cannot get a permit for its own work.

## Why

The human (2026-10-23), from a `squeal ps` of the host: nine cezar daemons (0.1.278) were `draining` with 46 to 84 files pending, 0% CPU, 1 to 13 CPU-minutes in their first hour, 300 to 600 MB each. A drain runs only its session's own work (slow files, an open `run --all`, a new failure's re-runs) and takes no slow permit while another worktree's mark is fresh (011-84 Q1 (b) and Q2 (a), row 011-93, 0.1.253). The coordinator's reading, not verified: on a busy host the drains wait the whole 60 minutes for the one slow permit and run nothing, and a worker's worktree is removed soon after, so the prune deletes what a drain did store (until 011-160). The human chose "Measure first" over exiting a drain that must wait, a 15-minute bound, or no drains.

## Read first

`tasks/011-84/design.md` (sections 1 and 2, its `probes/README.md`, `drains.py`), `research/stored-nothing.md`, `research/missed-sharing.md`; 011 C9 (the drain), C10; 004 D2 as amended 2026-10-21; `src/core/daemon/lifecycle.ts` (`drainable`, the departure check), `Scheduler.pauseBacklog`, `owedWork`, `slow-tier.ts`.

## Questions

1. **Drains since 0.1.253** (2026-10-22) in the cezar, squeal and toolkit-dev stores: count; what each drained for; how it ended (drained, the 60-minute bound, a session registered, a signal, the worktree removed); its runs, recorded seconds and CPU-seconds; the minutes it waited for a permit or the slow slot.
2. **Memory.** What draining daemons and their test processes held, from `/proc` samples over at least 20 minutes, with the load beside each sample.
3. **Worth.** For each drain's results: read later by a lookup (`last_used_at` more than 60 s after `recorded_at`), deleted with the worktree before any read, or, under 011-160's 7 days, reached later by another worktree at the same key.
4. **Who drains.** Worker worktrees (`.ai/cezar/worktrees/*`), main checkouts, others; minutes from departure to the worktree's removal.
5. **Options.** For (a) exit when the drain must wait, (b) a 15-minute bound, (c) no drains, (d) as today: daemon-minutes, MiB-minutes and CPU-seconds saved, and results lost that a later lookup read or would have read within 7 days. No design.

## Rules

- Copy a store (with its `-wal` and `-shm`) before reading it. Never open a live store, connect to a live daemon socket or touch the live permit pool; use `squeal ps` only if its source shows it opens no socket. Never run a script under `evals/bin/` or `tasks/*/probe/`; copy 011-84's `drains.py` into your probe directory and read it before you run it.
- Unset `PLUGIN_ROOT` and `PLUGIN_DATA`. Nice 10. Start nothing between 06:45Z and 07:30Z.
- Tag every finding: `verified by experiment`, `read in source code`, `read from store`, `read in official docs` or `inferred`. Lead with minutes, MiB and shares, then n. Budget about two hours.

Own `research/drains.md` and `research/probes/drains/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 5 each have an answer with numbers and tags and the probe README says how to re-run each. Commit.
