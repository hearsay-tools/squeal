# Research brief 011-148: why test work stores nothing, and when catch-up should start

Use /researcher. Shape: research. Outcome: for each part of the test work that stores no result, the rule that discards it, how much it costs and what would keep it; and, for catch-up, the CPU saved and the verdict delay of starting it later.

## Why

The human (2026-10-23) chose to explore what `research/edit-load.md` (row 011-143) points at. There, 39% of the recorded test time of 72 hours stored no result in squeal and cezar alike: timed-out runs 13% / 18% (an upper bound), runs that ended and were then discarded or replaced at the same key 11% / 8%, files cut when an edit cancelled a backlog tier 9% / 5%, inputs changed during the run 2% / 3%. In cezar, 59% of catch-up work and 69% of backlog work stored nothing. 42% of squeal's checkpoint work stored nothing. The causes were not determined.

## Read first

`research/edit-load.md` and `research/probes/edit-load/` (`work.mjs` classifies runs); `research/host-load.md`; `research/running-tier-yields.md`; `research/yields-replay.md`; 011 C4 (tiers, stability check, cancels, yields, quiet, timeouts), C5, C7, C10.

## Questions

1. **Each part of "stored nothing".** On fresh copies of the squeal, cezar and toolkit-dev stores: for each part, the rule in source that discards it (file and line), the files and recorded seconds, and whether a result at the same key exists on the host afterwards.
2. **Timeouts.** Which timeout fired (per file, tier, split), at what load, how often the same file and key timed out again, and what a timeout scaled by load or keeping completed files would save.
3. **The same key twice.** Why a key ran more than once: claims, forced runs, checkpoints, two worktrees, the stability check, a restart.
4. **When catch-up starts.** Replay the stores' revision sequences: if catch-up of an edit started only at the end of the agent's turn, or after a quiet of 60 s, 120 s or 300 s, how many CPU-seconds it saves, and how much later each catch-up FAIL of the 72 hours arrives (29 in squeal, 15 in cezar).
5. **Squeal's checkpoints.** Of their work, how much would have run anyway as catch-up, and why 42% stored nothing.
6. **Ranking.** Every fix candidate with the seconds it saves and what it costs in correctness or verdict delay, with evidence. No design.

## Rules

- Copy a store (with its `-wal` and `-shm`) before reading it. Never open a live store, connect to a live daemon socket or touch the live permit pool. Never run a script under `evals/bin/` or `tasks/*/probe/`.
- Probes clone under `/tmp`, never `git worktree add`, with `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and the npm, pnpm and corepack homes under `/tmp`; unset `PLUGIN_ROOT` and `PLUGIN_DATA`. Nice 10, at most 4 test workers, the one-minute load beside every timing. Start nothing between 06:45Z and 07:30Z.
- Stop everything you started and remove your clones at the end.
- Tag every finding: `verified by experiment`, `read in source code`, `read from store`, `read in official docs` or `inferred`. Lead with seconds and shares, then n. Budget about four hours.

Own `research/stored-nothing.md` and `research/probes/stored-nothing/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 6 each have an answer with numbers and tags and the probe README says how to re-run each. Commit.
