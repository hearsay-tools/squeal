# Probes for row 005-101 (throwaway)

Throwaway probes of `../../session-start-cost.md`. Kept as evidence; not maintained, not tests. Raw outputs stayed in the task's scratch directory.

Safety: every store probe works on copies in the task's scratch directory (`copy-stores.mjs`, SQLite's backup API from a read-only connection). In each copy, every `worktrees.daemon_socket` was rewritten to a path that does not exist before any hook code opened it, so no live daemon is reached. `step-budget.ts`, `runs-index.mjs`, `read-less.mjs` and `code-forms.mjs` refuse a path outside the scratch directory. The daemon spawn in `step-budget.ts` is a stub (`/bin/sleep 3`, detached).

| Probe | What it does |
|---|---|
| `copy-stores.mjs` | Consistent copy of one live store file, one backup step, read-only source |
| `hook-durations.py` | Claude Code transcripts: `durationMs` of each `session-start.mjs` hook record |
| `squawk-hooks.py` | Squawk run logs: Claude SessionStart items, step start to hook end, by status |
| `lock-share.py` | Daemon logs: logged store write-lock holds, their share of a window, a random write's wait |
| `table-sizes.mjs`, `orphans.mjs` | Table and index sizes and row counts; rows of unlisted or removed worktrees |
| `step-budget.ts`, `lock-holder.mjs` | The hook's code in-process on a copy, step by step, with an optional SQL trace and an optional second process that holds the write lock |
| `series.sh` | Traced series: several runs per process, each ensure variant, a held lock, main and the candidate |
| `series-fresh.sh` | Untraced series as a hook runs: one run per process, variants interleaved |
| `node-start.sh` | Node start and bundle load with the real bundle |
| `explain.mjs` | `EXPLAIN QUERY PLAN` of each statement over 5 ms |
| `runs-index.mjs`, `read-less.mjs`, `code-forms.mjs` | Index and set-based alternatives timed on copies; every write rolled back, every index dropped |
| `evict.py`, `quick-check.mjs`, `quick-check.sh` | Page-cache residency (`mincore`, also of a live store: no content read) and eviction of a copy (`posix_fadvise`); `PRAGMA quick_check` whole and per table on a copy |
| `summarize.py`, `profile.py` | Medians and p90 per group and step; CPU profile by callee of `registerNow` |

Run `step-budget.ts` with `node_modules/.bin/tsx` or `node --import tsx`, never `pnpm exec`.
