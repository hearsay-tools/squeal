# 019-39 notes: a hung `git hash-object` under the scheduler lock

Review `reviews/0.1.401-r2.md` N1. Commit `266dbc9a1`.

## What changed

`src/core/commit/stored.ts` gives its one `git hash-object --stdin-paths` its own bound, `STORED_BLOBS_TIMEOUT_MS = 2_000`, in place of the tree reads' `LS_TREE_TIMEOUT_MS` (30 s). After the bound, `runGit` kills git and rejects; `storedBlobs` returns an empty map, so every path stays a difference and its test file reads not determined. The call has no `-w`, so a killed git writes no object.

`test/commit/stored-stall.test.ts` puts a git shim first on `PATH` after the fixture is made. The shim hands every command to the real git except `hash-object`, which it records and then `exec sleep 45` (no child left for the kill to miss). Two cases:

1. `storedBlobs` on a stable file whose key matches the commit: git answers the blob; stalled, it returns an empty map in under 5,000 ms.
2. A real scheduler (catch-up fixture). `src/a.ts` has `eol=crlf`: CRLF on disk, LF in the commit, so only git's answer makes it the commit's. A control interval pass reads 0 not determined. After an empty commit, an interval pass reaches the stalled call; a watch batch handed then settles in under 5,000 ms, and the report reads `test/a.test.ts` not determined through `src/a.ts`.

The limit is the number 5,000 (2 s bound and 3 s slack), not the constant, so a longer bound fails. Red check, in a scratch copy with the bound set back to 30 s: both cases failed at 30,019 ms and 30,012 ms.

## Not done: the call outside the lock

The brief asked for it "if cheap". It is not inside this row's files. The call path, all under `Scheduler.#lock`:

`scheduler.ts` `#handleBatch` (takes `#lock`) → `#pass` → `batch.ts` `reconcileBatch` → `head-move.ts` `reportHeadMove` → `commitReport` → `compute.ts` `differingPaths` → `viewOf(context).storedBlobs` → `stored.ts` `storedBlobs`.

`updateCommitReport` (a report's one update) calls `commitReport` too; this row did not check which of its callers hold the lock. To move the call out, the scheduler would have to read the tree and hash the paths before it takes the lock (or release the lock across the await), then apply the result only if the stat cache still holds the same hashes. `storedBlobs` already checks the bytes against the cached hash and the stat across git's read, so its answer stays valid after the lock is retaken, if the cache's hash for each path is still the one asked. That change owns `head-move.ts` and `scheduler.ts`.

## Trade-off

A tree whose converted files git hashes slowly (a slow `filter`, many files) can pass 2 s. Then those files read not determined, as on a git error. The other git reads of a commit report keep their 30 s bounds; this row bounds only `hash-object`.
