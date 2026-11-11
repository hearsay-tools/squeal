# 020-17c notes: the gate keeps its results (D17.3)

## Where the write happens

- `src/core/code/gate/stored.ts` (`openStored`): the D11.7 lookup keys each selected file with the daemon's `WorktreeKeys` over a scratch store. A file it keys and does not find goes to `Keeper.expect` with its key. Prepare entries never reach the lookup. Parts files never reach it, because `inOrder` gives the store lookup only what the parts left.
- `src/core/code/gate/collect.ts`: `CollectOptions.ran` is told each runner's run after `mapPayloads`, before the next runner starts (`tellRan`). With `ran` set, the gate's Vitest observes runtime reads as `observe.runtimeInputs` says.
- `src/core/code/gate/keep.ts` (`Keeper`): the daemon's own rules and rows.
  - Kept only when the file completed, has a record, `observedGrowth` gives it no growth, no `environmentObserved` path is outside its project's keys, and `changedSince` finds no input of `stabilityPaths` changed. This is `store-decision.ts`'s `store` at the key it ran under.
  - Rows: `putParts` of the record first, then `recordsForFile` through `storeResults`, one transaction. A reader needs both, so a stop between the two leaves an unread record that prune removes.
  - Lock: `acquireDaemonLock(lockFileFor(commonDir, worktreeIdFor(root)))`, held only for the write. When the lock is busy, the gate writes nothing and tells one note.
  - Busy store (contract from spec 021's coordinator, through the parent): each write is one synchronous transaction, never across an await. It is tried in `BUSY_SLICE_MS` slices (`withBusySliceSync`) with `busyBackoffMs` between tries, under one bound per run (`KEEP_BUSY_BOUND_MS`, 10 s, as `squeal import`). The files not written by then are told as not kept, never as kept. `whileBusy` is in `src/cli/store-writes.ts`, which core code does not import, so `keep.ts` has its own `sliced`. Row 021-16 later moves this write to a daemon socket request.
  - Provenance: this worktree's id, its latest revision or 0, `readHead`'s commit and dirty flag, run id `gate-<uuid>`, so a daemon reads the origin `own`.
- `storeResults` now takes `Pick<SchedulerContext, "store" | "keys" | "worktreeId" | "now">`. This is additive.

## Choices the spec did not settle

- **Observation.** A daemon's Vitest observes runtime reads by default. A gate run without observation could keep a key that lacks a read, which then stays current when that file changes. So the gate observes whenever it may keep. Cost: the recorder in the gate's workers.
  - Without a daemon's stored observed rows, a file that reads at run time is not kept. Its first read is growth. The gate does not grow the shared observed sets.
  - `parts-environment.ts` now adds the recorder suffix only when it is missing (parent agreement).
- **No store.** `openStored` keys files without a store, so the first gate run can create one. Then every gate run with coverage and complexity on in the worktree opens the daemon's adapters to key. Before, that happened only when the stores existed. This is one more Vitest instance before the first run.
- **Previous checks** for D8's file-level error expansion: the checks of `newestForTestFile`, from any worktree. The daemon uses this worktree's last result key, which the gate does not have.
- **Children.** The gate keys with the base's `coverage.children`. When the head turns children on, the gate keeps at the children-off key. The worktree's daemon does not read that key, but a daemon with children off does.
- **Write notes.** A successful write is silent. Only a busy lock or a failure gives a note.

## For the next worker

- The header of `src/cli/code-gate.ts` now says the gate keeps what it completes (row 020-17 I).
- `commands.md` (3 copies): this row's paragraph on keeping comes right after the list of where evidence comes from, then 020-17ab's estimate and order paragraphs (row 020-17 I).
- The codex-runtime manifest sha256 of `commands.md` and the bundles are refreshed in the coordinator's bundle commit.
- Not done: growing the shared observed sets from the gate's reads, so that a reading file can be kept without a daemon. This needs `keys.addObserved` and the meta rows written as `storeResults`'s caller does. It is a scope decision.
