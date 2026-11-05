# Research brief 011-300: a main-checkout daemon, with today's numbers

Use /researcher. Shape: research. Outcome: whether a daemon on the main checkout that validates `origin/main` after each pull now saves more test CPU, or more agent waiting, than it costs, for cezar and squeal, with the numbers of 2026-11-05 beside those of 2026-10-23.

## Why

The human, 2026-11-05: "Yes, research it", after `research/new-worktree-baseline.md` (011-299) bounded such a daemon at 52% of new worktrees' first-baseline seconds (main content landed at least 30 min before the run), 11% at 120 min, and said it moves CPU rather than removing it. `research/main-daemon.md` (011-157, 2026-10-23) found it cost more than it saved (cezar 30,000 to 35,000 s against 21,246 s of misses) and the human parked it. Since then cezar grew about five times (`019-run-triggers/research/load-split.md`), runs `lookup-then-run-missing` (the human, 2026-10-27, kept 2026-11-05), and squash-merges into main.

## Read first

`research/main-daemon.md` and its brief and probes (reuse them); `research/new-worktree-baseline.md` section 4 and probes; `research/restart-baseline.md`; `research/main-pull-checkpoint.md`, `research/main-pull-reuse.md`; `research/daemon-memory.md`.

## Questions

1. **Cost.** Per main commit in the 72 h window of 011-299: the files a main daemon would run (re-keyed against the previous main commit it validated), their recorded seconds, and the total, with the option of validating only every Nth commit or only after a quiet period. Measure what it can from the store copy; estimate the rest and say so.
2. **Saving.** Of new worktrees' first-baseline and restart-baseline seconds, how much a main daemon finishing within T minutes of each main commit would have spared (T from that cost), and how much it would run that no worktree needed.
3. **Waiting.** How much earlier a new worktree's tests would be current (the human's 2026-10-27 reason): median and p90.
4. **Compare** with 011-157 row by row, and say which assumption changed.

## Rules

As in `research/restart-baseline-brief.md`, "Rules". No daemon on the real main checkout. Budget about two hours. Own `research/main-daemon-2.md` and `research/probes/main-daemon-2/` only. Done when questions 1 to 4 have numbers and tags. Commit.
