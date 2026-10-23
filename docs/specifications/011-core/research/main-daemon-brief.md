# Research brief 011-157: the main checkout as the baseline for new worktrees

Use /researcher. Shape: research. Outcome: the numbers and mechanics a design needs for the human's idea: the main checkout's daemon stays up and runs what is missing (`lookup-then-run-missing`), and linked worktrees start `lookup-only` and inherit its results.

## Why

The human (2026-10-23), after `research/missed-sharing.md` (row 011-152): "the main checkout would integrate changes and it would be the baseline for newer trees. It can still fail if we create worktrees from other branches, but maybe that could be a middle ground." Sharing works when content was run; lookup-only loses the start verdict only on content no local daemon ran (a pre-existing failure stays hidden, an edit's FAIL has no earlier state, `run --all` at the end runs more). Squeal's own repository switched to `lookup-only` the same day.

## Read first

`research/missed-sharing.md`, `research/stored-nothing.md`, `research/edit-load.md`, `research/daemon-memory.md`; 011 C3, C4 step 3 (lookups of keys other worktrees store), C9 (lifetime, exits, `squeal start`, consumers, idle and unused exits, the handoff), C10 (capacity), and `status.md` for 011-23, 011-69, 011-82.

## Questions

1. **Coverage.** On fresh copies of the squeal, cezar and toolkit-dev stores, and their git history: for each linked worktree's first daemon start in the window, the share of its files (and their recorded seconds) whose key at start equals a key of the main checkout's content at that time (its HEAD and working tree), had a daemon there run it. Split by where the worktree started: main checkout HEAD, `origin/<default>` ahead of it, another branch, a candidate commit.
2. **Cost in the main checkout.** What its daemon would run: per pull, merge or checkout in the main checkout over the window, the files re-keyed and their recorded seconds; whole suites after a release; at idle, CPU and memory of a daemon that runs nothing (`daemon-memory.md`).
3. **Lifetime.** Today's exits (C9) and what keeps a daemon up with no session in the main checkout: hooks in any worktree that ensure it, `squeal start` without consumers, a login service. For each: who starts it, when it exits, how it survives an upgrade (C9 handoff), and what a user sees.
4. **Telling the main checkout apart.** `git rev-parse --git-dir` against `--git-common-dir`, bare repositories with only linked worktrees, submodules, a main checkout used for work itself, more than one clone of one repository.
5. **What it would save and lose.** Recorded and CPU-seconds saved against today's default, and the share of worktree starts that would lose the start verdict, with the cases that cause it. No design.

## Rules

- Copy a store (with its `-wal` and `-shm`) before reading it. Never open a live store, connect to a live daemon socket or touch the live permit pool. Never run a script under `evals/bin/` or `tasks/*/probe/`.
- Probes clone under `/tmp`, never `git worktree add` on a real repository, with `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and the npm, pnpm and corepack homes under `/tmp`; unset `PLUGIN_ROOT` and `PLUGIN_DATA`. Nice 10, at most 4 test workers, the one-minute load beside every timing. Start nothing between 06:45Z and 07:30Z.
- Stop everything you started and remove your clones at the end.
- Tag every finding: `verified by experiment`, `read in source code`, `read from store`, `read in official docs` or `inferred`. Lead with seconds and shares, then n. Budget about three hours.

Own `research/main-daemon.md` and `research/probes/main-daemon/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 5 each have an answer with numbers and tags and the probe README says how to re-run each. Commit.
