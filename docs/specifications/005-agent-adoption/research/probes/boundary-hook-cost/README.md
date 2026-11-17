# Probes for row 005-110 (throwaway)

Throwaway probes of `../../boundary-hook-cost.md`. Kept as evidence; not maintained, not tests. Raw outputs stayed in the task's scratch directory.

Safety: every store probe works on copies in the task's scratch directory (`../session-start-cost/copy-stores.mjs`, SQLite's backup API from a read-only connection). `neuter-copy.mjs` rewrites every `worktrees.daemon_socket` of a copy to a path that does not exist before any hook code opens it. `boundary.ts` sets the hook's common dir to the copy (never `locate(cwd)`), uses a fresh random session id, and refuses any SQLite `prepare` or `exec` on a database outside the scratch directory. Its daemon spawn is a stub (`/bin/sleep 3`). `stub-daemon.ts` listens only on a socket in the scratch directory, writes only the copy, and runs no tests. `first-results.mjs`, `neuter-copy.mjs` and `evict.py --evict` refuse a path outside the scratch directory. Run the `.ts` probes with `node_modules/.bin/tsx`, never `pnpm exec`.

| Probe | What it does |
|---|---|
| `field-hooks.py`, `field-rate.py` | Claude Code transcripts: Squeal hook records by outcome; cancellations per tool batch and per prompt |
| `squawk-hooks.py` | Squawk run logs: hook items by event, status and output |
| `neuter-copy.mjs` | Rewrites a copy's daemon sockets |
| `boundary.ts`, `lock-holder.mjs` | PostToolBatch, Stop, UserPromptSubmit or a registration in-process on a copy, step marks, optional SQL trace, optional news (one state flipped), optional held write lock, optional served daemon |
| `stub-daemon.ts` | The write side of a serving daemon: the real `WriteDesk` and `writeBatch`, a set delay per batch, a log of each request and line |
| `first-results.mjs` | Replays "registered before the listing": hides a worktree's states, then restores them after a registration |
| `series.sh`, `first-series.sh` | Fresh-process series: ordinary boundaries per version; the owed first delivery, direct or served |
| `node-start.sh` | Node start and bundle load of the real bundles |
| `evict.py` | Page-cache residency (`mincore`, also of a live store: no content read) and eviction of a copy |
| `prof-sum.py`, `summarize.py` | CPU profile summary; medians and p90 per group |
