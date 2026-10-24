# Research brief 016-19: how many git-ignored paths tests load per run

Use /researcher. Shape: research. Outcome: how many git-ignored paths a test run loads or reads on squeal and on cezar, and how often the watched set would grow if they were kept, so that the human can decide `observed-paths.md` O1 (b). The human chose "count first" on 2026-10-25. Follow `README.md`.

Read first: `observed-paths.md` O1 and Q3; `src/runners/observe/inputs.ts` (what is dropped before growth); `src/core/scheduler/observed.ts` (`checkIgnored`); `src/core/scheduler/keying.ts:525-535` (`#extra` growth, `onExtraFiles`). 011's coordinator names the costs of (b): each growth is a watcher swap plus 011-187's reconciliation pass (0.3 to 0.6 s here), and `#extra` only grows during a daemon's life. `node_modules` is not a cost: `isProjectFile` drops it before growth.

Guards: scratch clones of squeal and `/home/agent/projects/cezar` under `/tmp`, with their `HOME`, `XDG_*` and `TMPDIR` there too. Never touch a live daemon socket or the live store. No e2e suites. Run suites under `nice -n 10`, one at a time, and only when the one-minute load is below the CPU count; check before each run. First look for a count that needs no run (static reads, existing logs).

Questions:

1. Per project (squeal Vitest, squeal node:test where present, cezar Vitest): the distinct git-ignored project paths the recorder sees in one full run, per test file and in total, by kind (load, read, stat, listing) and by top directory.
2. Over two consecutive runs with no edit: how many are new in the second run, and how many from the first no longer exist. That is the growth rate of `#extra` under (b).
3. Which of them a test's verdict depends on (a build output it imports, for example), and which only add re-runs (caches, logs, coverage).
4. A bound that keeps the useful ones: by kind, by directory, a cap, or dropping paths that no longer exist. What each bound keeps and drops in the counts above.

Cost: one coarse wall time per full run, with the one-minute load beside it.

Own `ignored-paths.md` and `probes/ignored-paths/`.
