# 001-258 notes: `status --wait` reads the store's re-key moves

The design is `research/wait-from-store.md` (001-256). These notes give the seam map and the choices the research left open.

## Seam map

- **Record**: `src/core/scheduler/rekeyed-moves.ts`. `recordMoves` is called in `Ledger.commit`'s transaction, after `recordRekeyed` and before the commit's own refined revision. `answerMoves` is the wait's read and `movesSeq` is the start view's sequence. The meta key is `rekeyed-moves.<id>`, which is in `WORKTREE_META_PREFIXES`.
- **Row shape**: `{seq, caughtUpAt, dropped, files: {testFileId: {open: [first, last] | null, resolved: {revision: [seq, at]}}}}`.
- **Wait**: `src/cli/status-wait.ts`.
  - Its first read stores `sinceSeq`.
  - Once the sync is `synced` with `moves`, each read calls `answerMoves` until it stops answering `refining`.
  - `answered` builds `editWindow` from those files.
  - `incomplete`, or a daemon without `moves`, sets `fallback` and takes the no-files path, with `isSynced` at the captured revision.
- **Sync**: `src/cli/status-sync.ts` sends `{type: "sync"}` only. `SyncState.synced` carries `moves`.
- **Daemon**: `#requestSync()` reconciles and returns the revision. `handlers.ts` answers `moves: true`. `protocol.ts` ignores an older CLI's `after` and `resolvedSince`, so that CLI gets no `rekeyed` and takes its "daemon before 001-186" path.
- **Removed**:
  - `discharges.ts`, `sync-requests.ts`, `sync-forget`, `forgetSync`;
  - `Scheduler.refined`, `rekeyedSince`, `rekeyedOnceRefined`;
  - `Ledger.discharges`, `FileState.lastKeyedAt`;
  - `SyncRequest.after` and `resolvedSince`, `SyncResponse.rekeyed`, `SyncAnswer.rekeyed`;
  - the tests `discharges`, `held-answers`, `held-deadline` and `held-socket`.

## Decisions the research left open

1. **`moves` on the sync answer (additive wire field).** The research's rule was "no `rekeyed-moves` row falls back". That misses one case: a newer daemon wrote the row, then an older daemon runs the worktree and never updates it. The row is then stale, its resolved entries all predate the wait, and a wait would end quiet on it. A daemon of this version answers `moves: true`, and a wait falls back without it. One edge remains: a newer daemon answers, then an older successor replaces it before the refinement. Its runner-part re-keys go unrecorded, but its results still clear the `pending` rows the wait counts.
2. **The sequence moves only when the row changes**, not on every commit. A move resolved after the start still has `seq > sinceSeq`, because every change bumps `seq`. This keeps a large record from being rewritten on commits that change nothing. The row is written at the first commit even when empty, so a wait right after a baseline does not fall back.
3. **Open moves are kept as earliest and latest** (as `keyedAt`/`lastKeyedAt` were), not every intermediate revision as the prototype kept them. A successor daemon's first move takes the minimum with the record's earliest open revision, so an edit a restart forgot stays owed.
4. **The catch-up is read before the commit writes its refined revision** (research F3). A commit that lands a stalled runner part therefore never starts the grace itself.
5. **A "commit" in the tests** is `recordMoves` with no marks at the scheduler's clock, which is what `Ledger.commit` does when nothing moved. The harness has a `now` option (`SchedulerOptions.now`) to shift that clock.

## Probes as tests

| Probe case | Test |
| --- | --- |
| 13k B1 | `test/scheduler/environment-growth-same-revision.test.ts` |
| 13k S1 | `test/scheduler/resolved-wait.test.ts` |
| 13l S1 (cached, control) | `test/scheduler/later-discharge-wait.test.ts` |
| 13q S1 count (10,050) | same file |
| 13s B2 (two hours, no commit) | same file |
| 13q S1 age, 13t S1 (commit past the hour while held) | same file |
| fallback, never quiet | same file, "a prune of its entry after the catch-up" |
| 13r B2 | `test/scheduler/moves-retention.test.ts` |
| D5 retry | `test/scheduler/moves-retention.test.ts` (answered while the retry hangs in `environment`) |
| The rules, one per control | `test/scheduler/rekeyed-moves.test.ts` |

**Controls.** Each control was checked by mutating `rekeyed-moves.ts` to drop one property, running the named test, and restoring the file. All four are red without their property:

| Control | Mutation | Red test |
| --- | --- | --- |
| `noReopen` | a move to a resolved revision is not opened | `environment-growth-same-revision`: both waits end `quiet` while a's re-run is held |
| `openOnly` | the answer names no resolved move | `resolved-wait`: `quiet` where `news` was expected |
| `perFile` | a move drops the file's earlier entries | `later-discharge-wait` cached case: `quiet` where `news` was expected |
| `ageOnly` | prune with no catch-up rule | `later-discharge-wait` "past the hour" case: math's entry pruned while held |

## For the next worker

- 001-254 takes `rekeyed-moves.` into its prefix table.
- The record's size per commit on a large repository is still unmeasured (research, open question 2).
- 001-228's bound does not cover `retryRunner` or the baseline (research F5 and open question 4). A hung retry before the capture still holds a wait until its own timeout. It never ends quiet.
