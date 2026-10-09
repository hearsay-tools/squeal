# 004-23 notes: the wave-2 review's B1 to B3

Seam map left for whoever continues.

## B1, the slow tier's activity

- `SlowTier.#select` publishes `running` inside the `store.transaction` that `startTier` commits the file's `running` phase in, so no reader sees one without the other.
- `TierScheduler.#fly` records every tier inside one outer `store.transaction` (`recordTier` nests as a savepoint). A slow run calls `SlowTier.recorded`, which records the run's artifact (B2) and calls `ended`; a fast run calls `forgetSlowRuns`.
- `SlowTier.ended(othersInFlight)` is what the remaining slow files wait for, decided without starting one: none queued clears; another lane's tier in flight or fast work pending is `fast`; no trigger is `idle`; a trigger that holds clears, and `next()` publishes slot, load or running moments later. `#requeue` (a tier that threw before recording) calls it too.
- `close` calls `SlowTier.retire`, which clears the activity only when the stored value is still what this tier last published, so a successor daemon's activity is never erased.
- The reader (`readSlowTier`, `liveActivity`) drops a `running` activity unless the named slow file's key row has `pending: "running"`. This covers a daemon killed mid-run whose row and activity both stay (the liveness sentence then hides the activity anyway).
- The 004-15 notes saying "nothing is published at a run's end" are out of date.

## B2, the artifact a slow run was declared to test

- The record is the `meta` row `slow-artifacts:<worktreeId>` (`src/core/slow/state.ts`): JSON `{ key: globs }`, oldest first, the newest `SLOW_ARTIFACTS_KEPT` (256) keys. No schema change; agreed with the coordinator on 2026-10-09.
- The globs are captured at selection from `context.policy` (`slowPolicyView(...).artifactFor`), carried on `SlowRun.artifact`, and written for `tierKeys(tier, ledger)`: the run key and the file's key after recording (an observed-growth re-key stores results under that).
- A fast run of a key removes it: that key's results are no slow run's any more.
- Delivery (`slowRunArtifact` in `attribution.ts`) finds the failure's result: the newest failing result of the origin worktree at the entry's revision (own) or commit (inherited), and reads the record at that worktree. A record means a slow run, whatever today's policy marks. With no record, a file today's policy marks slow gets `slowArtifact: null` ("declared artifact unknown"); any other file gets the ordinary changes line.
- The header's current claim (`readSlowTier`) reads each current slow file's record by its current key (a current result's key is the file's current key) at the worktree its current states came from. Pending files contribute no globs. A current file with no record counts in `SlowTierState.artifactUnknown`. Today's globs of those files are used only to tell source changes from artifact changes for "sources changed since"; they are never printed.
- The row is never pruned with its worktree. Like `slow-tier:<worktreeId>` (004-15) and the other per-worktree `meta` keys, it stays when the worktree is removed or pruned: one row of at most 256 keys. A worktree id is a hash of the path (`worktreeIdFor`), so a worktree re-created at the same path finds its old records. Their keys match only results whose inputs hash the same, so those records stay true. `store.prune` is the 001 lane's, so this row is not deleted there.

## B3, Stop's decision

- `decide` in `src/harness/shared/stop.ts` reads states, keys and the live header in one `readTransaction`; `readLiveHeader` takes the keys (new last parameter).
- When the decision lets the turn end silently and a policy could block, `endTurn` gets `atRevision`. In its write transaction it writes nothing and returns `false` when the latest revision moved, and Stop decides again, at most `STOP_DECISIONS` (3) times; the last attempt ends the turn unconditionally.
- `test/harness/stop-require-slow-snapshot.test.ts` commits the daemon's next revision after each read Stop makes outside write transactions, one at a time, in both harnesses.

## Not done

- `slow-tier.ts` is about 400 lines and `scheduler.ts` about 600; both were already over 300 before this row.
