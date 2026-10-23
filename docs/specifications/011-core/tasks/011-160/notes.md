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
