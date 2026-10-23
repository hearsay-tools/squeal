# Research brief 011-143: what one edit costs the machine, and how much of it is needed

Use /researcher. Shape: research. Outcome: per edit and per hour of agent work, the CPU that Squeal's test runs take on three repositories, split into shares that each name what the share buys, with the part no changed code reached measured, so the human can weigh their own ideas against numbers.

## Why

The human (2026-10-23): "This tool was supposed to reduce how much tests are run and have the agent not wait for it / not make the agent ask for them. What seems to be an unintended side effect is - the machine is loaded all the time because every single edit runs A LOT of tests. Not saying the current shape is wrong, but I am afraid that people won't use it because it will load their machines too hard. I have some ideas for it, but for now - research it first."

Known: Squeal's daemons were 70% of this host's busy CPU (`research/host-load.md`); an edit of a shared module re-keys 213 to 472 cezar test files, 10 of them edited or direct importers at the median (`research/central-edits.md`); `src/core/fs/` is in 84 to 85% of Squeal's closures; in Squeal 60% of picked files stored a result.

## Read first

`docs/vision.md` (the decision filter); `research/host-load.md` and `research/probes/host-load/`; `research/central-edits.md`; `research/edit-cut.md`; `research/watch-mode-comparison.md`; `research/edit-latency.md`; 011 C3 (keys), C4 (edit work, catch-up, tiers, quiet, cancels), C5 (re-runs), C10 (capacity), C12 (policy, lanes).

## Questions

1. **One edit.** For each repository (squeal, cezar, toolkit-dev) and edit class (a test file, a leaf module, a mid module, a hub such as `src/core/fs/` or cezar's `packages/contract/src/`): files re-keyed, files run, CPU-seconds of every test process (user plus system, children included) and busy wall time until the daemon is idle again. Beside each, two baselines an agent without Squeal would run: the edited file's own tests (or `vitest related`), and the whole suite.
2. **One hour of work.** From copies of this host's stores, for the last few days of real sessions: Squeal's test CPU per hour of agent work, split into edit work, transitive catch-up, C5 re-runs, checkpoints (`run --all`), runs that stored nothing (cancelled, discarded, superseded), the same key run in more than one worktree, and the slow lane.
3. **The part no change reached.** For a sample of at least 30 real edits across the edit classes, with per-test coverage in a probe (V8 for Vitest, coverage.py for pytest): of the files Squeal re-ran, how many had no test that executed a changed line, and their share of the CPU. Also by export: how many re-ran files import no changed export of the changed module. Say what coverage misses (spawned processes, read files, config) and how often that would have been a false pass, against the edit's true result.
4. **A user's machine.** One worktree, one agent, 8 CPUs (`taskset`), current defaults: CPU share and one-minute load during a burst of about 20 edits in 10 minutes on squeal and on cezar, and the time to each edit's result.
5. **What each knob does today.** `runner.tierSize`, `capacity.hostSlots`, the edit cut's K, the quiet, the slow lane and nice: the change in CPU per edit and in time to result, where cheap to measure.
6. **Ranking.** The shares of questions 2 and 3 ranked by CPU-seconds, each with what it buys (a verdict, an earlier verdict, nothing) and what removing it would cost in correctness, with evidence. No design: the human has ideas of their own.

## Rules

- `git clone` each repository under `/tmp`, never `git worktree add`; install offline. Run every tool with `HOME`, `XDG_*`, `TMPDIR` and the npm, pnpm and corepack homes under `/tmp`. Use Squeal from the clone's committed `plugins/claude-code/dist`. No build in your worktree.
- Copy a store (the database with its `-wal` and `-shm`) before reading it. Never open a live store, connect to a live daemon socket or touch the live permit pool. Never run a script under `evals/bin/` or `tasks/*/probe/`.
- This host is shared and loaded. Run probes at nice 10 with at most 4 test workers; prefer CPU-seconds to wall time; write the one-minute load beside every timing. Start nothing between 06:45Z and 07:30Z (the daily host-load run).
- At the end, stop everything you started, remove your clones, and show that nothing of them is left.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Lead with seconds and shares, then n. Budget about four hours.

Own `research/edit-load.md` and `research/probes/edit-load/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 6 each have an answer with numbers and tags, the ranking names every share above 5% of Squeal's CPU, and the probe README says how to re-run each measurement. Commit.
