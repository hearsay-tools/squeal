# 011-160 worker notes: a removed worktree's results kept for 7 days

Worker of row 011-160 (wave 26, W2), 2026-10-23, from main 27d481c0e (0.1.279). Brief: `tasks/wave-26.md` W2. Read: 001 D8 (Pruning) as amended 2026-10-23, `research/stored-nothing.md` finding 1, `research/missed-sharing.md` C1.

## 1. Growth on store copies, before the change

**Answer.** Over 72 h the rule keeps at least 66,000 (squeal) and 70,000 (cezar) more result rows, about 49 MB and 45 MB of store, with no more logs. The copies can show only that much. One older cezar copy shows real growth far above that floor. In 9 hours of one day, 12 cezar worktrees removed since then stored 306,841 rows in 2,733 runs: about 196 MB of store and 245 to 293 MB of logs. The current prune deleted all of them. If every removed worktree stored like those 12, the 72 h ceiling is about 1.2 GB of store and 1.5 to 1.8 GB of logs in cezar, and about 1.1 GB and 2 GB in squeal. The 7-day steady state is 7/3 of the 72 h growth. `store.maxSizeMb` is unset by default, so nothing bounds it. *read from store copies; the ceiling modelled.*

**Copies.** `store.sqlite` with `-wal` and `-shm` and a snapshot of `runs/`, for squeal and then cezar, taken back to back at 19:42:39Z to 19:42:42Z (copy time 1792784562872). The window is the 72 h before that: 10-20T19:42Z to 10-23T19:42Z. The worktree counts come from copies of each repository's `.ai/cezar/runs.db`. The older cezar copy O is `/tmp/t75/repo/.git/squeal/store.sqlite`: a copy of cezar's store whose last run started at 10-21T16:08Z (51.6 h before), which another task left there. It has no `runs/` snapshot. I copied O before I read it. Opening it in place once, read-only, wrote a `-shm` file and an empty `-wal` file beside it; `store.sqlite` itself did not change. No daemon, test or Squeal command ran on any copy. Probes: `probes/` (throwaway). Each runs at nice 10 as `node <probe> <args>` and opens its stores read-only.

**Unit costs** (`growth.mjs`, from `dbstat`):

| | squeal | cezar |
|---|---|---|
| store (pages in use) | 170.1 MB | 690.4 MB |
| result rows; bytes per row with its 6 indexes | 104,016; 750 B | 571,327; 638 B |
| runs; bytes per run row | 1,011; 2.1 KB | 4,897; 0.9 KB |
| `runs/` logs | 283.6 MB | 919.1 MB |
| log bytes per file run: runs of live worktrees; surviving runs of removed ones | 12.3 KB; 10.6 KB | 19.3 KB; 16.2 KB |
| checks: files, tests | 966, 8,330 | 1,016, 23,322 |

**A. Rows the copies can see (lower bound).** A run of a removed worktree survives the current prune only while a result under a live key still names it: 294 runs (squeal) and 197 (cezar) in the window. Their reports list 81,837 and 87,008 test results plus 12,327 and 4,429 files. Runs of live worktrees still hold 1.12 and 1.07 rows per reported test, because the file check is a row too. At those ratios the removed runs would hold 91,900 and 92,800 rows. They hold 26,229 and 22,298. So the current prune deleted about **65,700 rows (49 MB) in squeal and 70,500 rows (45 MB) in cezar**. Their logs stay already, because each of these runs still has a result. A run whose results were all pruned was deleted with its log, so A cannot see it.

**B. What A cannot see, from the older cezar copy** (`calib.mjs`, `adds.mjs`). 17 worktrees that were live in O have been removed by now. 12 of them stored 306,841 rows in 2,733 runs (15,152 file runs), all started between 10-21T06:56Z and 16:08Z. Now only 5 of those runs survive, with 1,471 rows, so A sees 2.4% of this work. None of the 306,841 `(check, key)` pairs has a row in the current store, so none was replaced by a later run at its key. Every row is growth under the rule: **196 MB of store and 245 to 293 MB of logs** (15,152 file runs at 16.2 to 19.3 KB). These numbers cover only the 9 h that O reaches back in the window, and only the worktrees that were live at O.

Side observation, not followed: in each of those 5 runs the same check has one key in O and another in the current store, with the same run id. Some path re-keys a stored row. Main's rows have the same key in both copies (53 of 53).

**C. The 72 h ceiling (modelled).** In cezar's `runs.db`, 106 cezar worktrees and 219 squeal worktrees were created in the window and are now removed. B gives the cost of each worktree that stores: 12 of 17 stored, at 25,570 rows and 1,263 file runs each. For cezar that is 106 × 12/17 × 25,570 ≈ **1.9 M rows, about 1.2 GB of store; logs 1.5 to 1.8 GB**. Squeal's suite is 9,296 checks against cezar's 24,338. At the same rows per check (1.05) and the same storing share: 219 × 0.71 × 9,800 ≈ **1.5 M rows, about 1.1 GB; logs 155 × 1,200 file runs × 10.6 to 12.3 KB ≈ 2.0 to 2.3 GB**. The ceiling is high for these reasons: worktrees at the same content share one row per `(check, key)`; the measured day was a dense wave day; and 011-159's `lookup-only` default removes most start baselines, which are most of a worker's rows. The ceiling is low for one reason: a worker's edits add rows at new keys beyond one baseline.

**What it means.** Current stores are 170 MB and 690 MB, so the rule can make them several times larger within a week, and `runs/` grows faster than the store. Every store byte here is result rows. The logs are the runs those rows keep. The spec keeps both for 7 days (D8 as amended); this measurement does not change the decision. If the coordinator wants a bound, the levers are a default `store.maxSizeMb` (eviction is least recently used first, and the rows of removed worktrees are not under live keys, so they go first), or keeping a removed worktree's results without their run logs. Both are spec decisions and outside this row.

## 2. The change

`src/core/store/prune.ts`:

- `PRUNABLE` is `UNPROTECTED AND recorded_at < cutoff`. The clause `OR worktree_id NOT IN (SELECT id FROM worktrees)` is gone. A removed worktree's result now follows the same rule as any key that no live worktree holds. A key that a live worktree holds still protects the result, and so does main's newest result per check.
- The one runs delete is now two steps. Each step deletes the run rows and their logs, and each reads the runs that replaced failures and standing UNKNOWNs keep inside its own write transaction, as the single delete did.
  - `dropLiveWorktreeRuns`: as before. A run goes when it ended before the cutoff and nothing names it.
  - `dropRemovedWorktreeRuns`: a removed worktree's run goes, with its log, once nothing names it. A run that stored nothing goes at once, finished or not, because no daemon of that worktree is left to finish it. A run whose results stay goes in the prune after its last result passes the cutoff. Its own step, at the coordinator's request (2026-10-23), so that a different log rule for a removed worktree's runs fits in this one function.
- These are unchanged: `worktrees.remove` (revisions, file hashes, keys, known states, transitions, consumer views, consumers and meta rows go at once); checkpoints (a removed worktree's checkpoint goes unless a kept run is one of its tiers); `checks` (a check goes when only the removed worktree's states or views named it); the size cap (a removed worktree's results are in the first, unprotected tier, evicted least recently used first).
- `src/core/types/store.ts`: the doc comments of `WorktreeRepo.remove` and `Store.prune` now quote D8 as amended. Comments only, in their own commit 172a0f88d. The file is not in this row's ownership; the coordinator accepted the edit.

**Decisions the spec did not settle.**

1. "Their runs" (done-when) means the runs that a kept result names. A removed worktree's run with no kept result goes at once, as before, because no result needs its log to explain it. The other reading is that every run of a removed worktree waits 7 days. That reading keeps the logs of runs that stored nothing, and it needs a rule for runs that never end.
2. A removed worktree's checkpoints keep the current rule. Spec D7 needs a checkpoint only for a live worktree's status, and a kept run keeps its checkpoint already.
3. `test/status/why-replaced-pruned.test.ts` (review 0.1.265 B2) set up "a kept replaced failure with no result left" through the removal itself. Under the new rule, removal gives that state no longer: the replaced failure expires at the cutoff by its own `recordedAt`, which is earlier than the pass that replaced it. The size cap is now the path to that state, so the seed prunes with `maxSizeMb: 0`, and the assertions are unchanged.

**Tests.**

- `test/store/prune.test.ts`: the first case now keeps `k-removed-recent` and `run-removed` with its log. In the eviction case, every other evicted result belongs to the removed worktree, and the order of eviction stays the same.
- `test/store/prune-removed.test.ts` (new):
  - Store level: a removed worktree's 6-day-old result and its run and log stay. Its 8-day-old result goes, although the key was current in that worktree. Its runs with no result go at once, finished or not. Its known states, views and the checks that only they name go. Two days later the 6-day-old result goes with its run and log.
  - Real Vitest runs over a real store: worktree A runs the fixture. A's `.git` entry goes and the prune removes A, with 0 results removed. Worktree B at the same commit has equal keys, runs nothing, and inherits `adds` as a current pass from A. With B removed too, a prune 8 days later leaves no result, run or log of A.
- Mutation check: with the previous `prune.ts` restored in the worktree, all four of those checks fail (`resultsRemoved` 11 instead of 0 in the Vitest case; 2 and 4 instead of 1 and 3 at store level; 75 evicted results instead of 0 before the cap; the first case 4 and 3 instead of 3 and 2).
- `test/store/contention.test.ts` and `test/daemon/shared-store.test.ts` still prune the results of a removed worktree in batches. They seed those results at `recorded_at` 1000, which is past any cutoff, so they still test the batching unchanged.

## 3. For whoever continues

- **The human's decision on the growth** (2026-10-23, from the coordinator): "Summary report, keep 7 days". A removed worktree's results, its runs and their run folders follow the same 7-day cutoff, as D8 is amended. There is no separate log rule and no option. Row 011-164 (W5) cuts the size instead: each run folder keeps only the console log and a compact summary of the report, about 87% smaller. This row does not touch the run-log writers. The log deletion for a removed worktree's runs stays its own step (`dropRemovedWorktreeRuns`), as the coordinator asked. Section 1's log figures are for today's run folders; with 011-164 they shrink by about that share.
- If a different log rule for removed worktrees is ever wanted, it goes in `dropRemovedWorktreeRuns`: select `log_dir` of the runs whose worktree is gone and that the rule drops, remove those logs, and keep the rows, because `results.run_id` is `NOT NULL`. `why` already has a `pruned` log state (`src/core/status/why-unknown.ts:63`).
- 011-159 (`lookup-only` by default) makes a new worktree depend on these results. The test in `prune-removed.test.ts` checks the inherited state and not only the absence of runs, so it still discriminates under that default.
- Not followed: the 5 runs that survived from the older cezar copy each have one key per check in O and another key in the current store (section 1, B).
- `/tmp/w160` holds the copies and is removed after this row's review. `/tmp/t75` belongs to another task; it is left as it was, apart from the `-shm` and empty `-wal` files that section 1 names.
