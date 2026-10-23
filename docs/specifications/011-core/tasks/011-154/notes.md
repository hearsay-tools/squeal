# 011-154: a new worktree's misses take their duration from the file's newest stored result

Worker c86b031a, 2026-10-23, wave 25 W2.

## What changed

- `src/core/scheduler/bootstrap.ts`: a miss with no previous key no longer skips its duration. It
  takes `durationOf(store.results.newestForTestFile(file.ref))`, the same read the 004-54 case (a
  previous key with no rows) uses. The private helper `newestResults` is gone.
- `src/core/store/repos/results.ts`, `src/core/types/store.ts`: `ResultRepo.newestForTestFile`
  (additive). One statement: the file's newest row by `recorded_at DESC, rowid DESC` names the
  key, then that key's rows of the file, with failure text, ordered as `byKey` orders them. It
  writes nothing, so last-used never moves (D8).

## Start cost

`start-cost.ts` reads every test file of a copy of squeal's store (`VACUUM INTO` from the main
checkout's store, 2026-10-23 19:01Z: 155,799 results, 9,317 checks, 970 test files, each with a
stored result). One pass over all 970 files is what a start pays when every miss has no previous
key. Median of 7 passes, warm cache, on the shared host:

| Read, 970 files | Run 1, load 92 | Run 2, load 109 |
|---|---|---|
| `newestResults` as d663048d8 shipped it (checks, newest per check, then `byKey`) | 441 ms | 544 ms |
| `results.newestForTestFile` (shipped) | 149 ms | 96 ms |
| `byKey` of a known key alone (what a restart already reads per miss) | 84 ms | 82 ms |

Files whose duration differs between the two reads: 0 of 970. An earlier probe of the bare
statement returning only `kind` and `duration_ms` took 58 ms at load 54: the rest of the shipped
read's time is the failure-text join and the row mapping, kept so the read returns
`ResultRecord`s as `byKey` does.

So a new worktree's first start at about 900 misses pays about 0.1 to 0.15 s more on this host
today, once; a later start pays it only for files with no previous key (new files) and for the
004-54 case, which paid the slower read before. Query plan: the checks' unique index, then
`results_by_check_time` with a temporary B-tree for the sort, then the primary key per check.

## Test

`test/scheduler/fresh-worktree-durations.test.ts`: a main worktree's daemon runs 200 files of
10 s each over a real store; a linked worktree at a commit that moves every key starts with no
previous key. Its first baseline tier holds 45 files (the budget at 4 workers:
`45 × 10 / 4 + 0.75 × 10 = 120 s`), not 200, and the main worktree's rows keep their last-used
times. Red before the change: the first tier held 200.

`test/store/newest-for-test-file.test.ts`: the repo read across worktrees, keys, files and
projects, and that it writes no last-used time.

## For the next worker

- The duration also helps a `lookup-only` start (squeal's own baseline since 5a5bbc9ba, and
  cezar's): the misses are not queued there, but they keep the duration on the ledger, so a later
  catch-up or `run --all` backlog tier is budgeted by it.
- `ResultRepo.latestForCheck` now has no caller in `src/`; tests in `test/delivery`,
  `test/integration` and `test/store` still use it, so it stays.
