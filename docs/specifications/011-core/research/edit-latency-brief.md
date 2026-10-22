# Research brief 011-115: where a minute goes between a Python edit and its result in toolkit-dev

Use /researcher. Shape: research. Outcome: a timeline of each edit in the human's 2026-10-22 test in toolkit-dev, from file write to current result, with the seconds each stage took, the cause of each long stage, and the narrowest fix per cause as candidate rows.

## Why

The human (2026-10-22, about 13:15 to 13:30Z): with a fresh daemon in `/home/agent/projects/toolkit-dev`, an edit to `plugin-tools/estimate-pricing/cli.py` took a long time to be noticed and about a minute to give its result. Reverting it was fast once and about a minute the other time. `uv run pytest` in that tool's directory runs all its tests in 2 seconds. `squeal ps` showed a Vitest worker at 100% CPU in that project. Agents ignore a lagging Squeal (performance first, 2026-10-19). The human: "This is not what we want this product to be."

## Evidence already seen (coordinator, read-only)

- Daemon pid 3769175, 0.1.263, worktree id c5357edc, started about 13:19Z, idle at 13:30Z. A second daemon, pid 1645161 on 0.1.262, serves the Cezar worktree `toolkit-dev/.ai/cezar/worktrees/cadf5144-…` and shares the store.
- Store `toolkit-dev/.git/squeal` (`store.sqlite` with WAL, `runs/`, `pytest/`). The eight newest `runs/` directories (13:21 to 13:27Z) hold only `vitest.log` and `report.json`, several from `tools/generator/tests/publish.test.ts` (tests of about 4 s each). One ends `squeal: run cancelled: the revisions during it changed an input of every file that had not ended`.
- `squeal.config.json`: Vitest, two `nodeTest` projects, one `pytest` project including `plugin-tools/**/test_*.py`; `observe.runtimeInputs: true`; `runner.tierSize: 4`.

## Questions

1. **Timeline.** For each edit and revert in the window: when the file changed (from the revision record), when the daemon recorded the revision, which checks it queued, and when each started, ended and became current. Name the stage that took the time.
2. **What a `.py` edit invalidates.** Which checks of each runner did it make stale, and through what (closure, an observed runtime input, an environment input, a config input)? Is each one correct? Does a Vitest file such as `publish.test.ts` read `plugin-tools/` at run time?
3. **Ordering.** Does the pytest check of the edited tool wait behind Vitest work: a shared tier, the host permit pool, queue order, or a cancel and restart? What is Squeal's own run time for that pytest file against the 2 s `uv run pytest`?
4. **Notice delay.** Watcher event to revision: how long, and why.
5. **Scope.** Which causes are toolkit-dev only and which hit any repository with mixed runners or runtime inputs?
6. **Recommendation.** The causes ranked by seconds lost, each with the narrowest fix, the spec section it changes (011 C4 and C5, 007, 013), and its regression test.

A lead, not a rule: copy `store.sqlite` and its `-wal` and `-shm` files to `/tmp`, then read the copy with `node:sqlite`. The host has no `sqlite3`.

## Rules

- The live host is read-only evidence. Never connect to a live daemon's socket, open a live store, or signal a process. Do not edit anything in toolkit-dev.
- To reproduce, `git clone` toolkit-dev under `/tmp`, never `git worktree add`. Install offline (`npm ci --offline`, `uv sync --offline`). Run the scratch daemon with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`, at most 4 test workers. No build in your worktree. Record the one-minute load beside each timing.
- At the end, stop what you started, remove your clones, and show that nothing of them is left.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Budget about two hours.

Own `research/edit-latency.md` and `research/probes/edit-latency/` only. Edit no board, spec, status, test or product file.

Done when every numbered question has a tagged answer or "not determined, because", and the timeline accounts for at least 80% of each slow edit's minute. Commit.
