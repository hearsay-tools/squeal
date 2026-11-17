# Research brief: why the tool-boundary hooks pass their 2 s limit in cezar

Row 005-110, asked by the human 2026-11-17. Coordinator: session cfa29290. Use /researcher. Findings file: `boundary-hook-cost.md` beside this brief. No product code changes.

## The observation

Cezar task d9416fae (Squeal 0.1.546, `worktreeSetup` runs `pnpm install` then `squeal start`): 25 of 26 hook runs ended `cancelled`, exit 1 (PostToolBatch, Stop, UserPromptSubmit); only SessionStart completed. Earlier cezar tasks without `squeal start` show the same (345 of 358, 59 of 67), so the setup is not the cause. Claude Code reports `cancelled` when a hook passes its `timeout` (2 s for these, `plugins/claude-code/hooks/hooks.json`). Run by hand in that worktree at load about 10, the PostToolBatch hook exited 0 in 1.1 s twice (no output) and 8.8 to 11.6 s three times (with a delivery text). A CPU profile of a 1.3 s run: about 0.5 s idle, the rest in the bundle's counting (`countNotCurrent`, `laneCounts`, `countSlowPending`, `testFileId`). The cezar store is 11 GB (`code.sqlite` 1.7 GB), 1,922 test files. 005-101 (`session-start-cost.md`) timed SessionStart only.

## Questions

1. A time budget of one PostToolBatch and one Stop hook, start to exit, by step (as 005-101 section 1): bundle load, store open, each read with row counts and query plan, the delivery, formatting, any write and its lock wait, exit. Median and p90 on copies of cezar's and this repository's stores, with and without a writer holding the lock, at the host's real load, stated per run. Do the same on main (0.1.548: 005-106).
2. What makes a run take 9 to 11 s: a lock wait (whose busy timeout, which writer), a cold page cache, or the work itself.
3. Which reads the texts of 0.1.548 still need; what 005-101's candidates 5, 6 and 8 (index on code `counts`, partial index on open runs, a daemon-kept summary row) save at the boundary.
4. Whether the hook can end inside its limit by design: a time bound that says less, rather than being killed and saying nothing.

## Sources and limits

`src/harness/shared/**`, `src/core/delivery/**`, `src/core/state/**`, `src/core/store/**`, `session-start-cost.md`, `consumer-view-design.md`, issue #138. Squawk run logs (`~/projects/cezar/.ai/squawk/runs/*.ndjson`) list each cancelled hook. Work on copies of the stores in your scratch directory; never write to a live store; never run a hook against a live store with a real session id (it consumes that session's deliveries); never run `evals/bin` scripts; make no load on purpose. Write `~`, never a `/home/<user>/` path.

## Deliver

The budget table; the cause of the slow runs; candidate rows ranked by measured gain per cost, each with its owner (hook and delivery: 005; store and daemon: 011) and its effect outside Squawk; what stays unknown.
