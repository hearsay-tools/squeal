# 011-350: background store writes pause between batches (#220)

Worker 912adabb, 2026-11-14. Brief: `../wave-96.md` W1.

## The pause owner

`turnGapMs(heldMs)` in `src/core/store/write-turns.ts`: the pause after a slice is as long as the slice held the lock, and at least `MIN_PRUNE_GAP_MS` (10 ms). `MIN_PRUNE_GAP_MS` moved there from `src/core/daemon/sliced-prune.ts`, so `src/core/store/` does not import from the daemon. Both drivers call it:

- `SlicedPrune` (`src/core/daemon/sliced-prune.ts`), for the main store's prune and now the code store's prune.
- `importSliced` (`src/core/store/transfer-import.ts`).

No number is tuned to this host. The hold is measured on each slice. The 10 ms floor is the one row 021-09 set.

## The callers that now pause

- The daemon's code-store prune. `lifecycle.ts` runs `pruneCodeSlicesAfter` through the same `SlicedPrune` after the main prune. Before, it ran in one synchronous call inside `retries.run("pruning", ...)`.
- The daemon's import request (`src/core/daemon/import-request.ts`), through `importSliced`.
- The shared results reader (`src/core/shared/reader.ts`), through `importSliced`.
- The CLI import (`src/cli/import.ts`), through `importSliced`.

`importResults` (the synchronous import) and `prune`/`pruneCodeStore`/`pruneCodeStoreAfter` (the synchronous prunes) run the same slices back to back, with no pause. Only tests call the synchronous prunes; they keep the old reports.

## Extra wall time

A prune of N batches, each holding the lock for h ms, takes about N × max(10, h) ms more: about twice its time under the lock. The main store's prune already paid this cost (row 021-09). For the code prune: a batch of 256 rows on a small store holds for 1 to 5 ms, so the floor applies, and 100 batches add about 1 s. A large store's 50 ms batches add about as much time as they hold the lock.

An import of S slices takes about S × max(10, h) ms more. The import also pauses after its last slice, before it returns (at least 10 ms). A dry run is one slice, so it adds one pause.

The hold is measured around the try that committed. That time includes the try's own busy wait for the lock, up to `BUSY_SLICE_MS` (250 ms), as `SlicedPrune` already measured it. After a contended slice the pause can be up to 250 ms longer than the true hold.

## Tests and how they discriminate

- `test/code/prune-turns.test.ts`: a code prune of 6 full batches on a scratch code store, run by `SlicedPrune`. A waiter thread uses a 250 ms busy slice and the 0, 100, 250 ms backoff, as `starve.mjs` does. A TEMP trigger on the prune's connection only holds each batch for 50 ms more, so the store's schema is unchanged. The test asserts that the waiter landed between the first and last batch.
- `test/store/transfer-import-sliced.test.ts`, "lets a waiting writer ... land between its slices": the same rig on an import of 6 results slices. Its own WAL auto-checkpoint is off (see below).
- The rig is in `test/store/write-turns-rig.ts`. Both tests assert landings, not counts.

With the pause removed (a no-op `pause`), on this host under heavy load from other sessions (load average 84 to 150 when I read it):

- The prune test failed 14 of 15 runs, and 9 of 10 at 12 batches.
- The import test failed 10 of 10 runs.
- With the pause, both passed 5 of 5.

The rare pass without the pause is a real lock-free gap. I measured the time between a slice's COMMIT and the next BEGIN at about 0.2 ms, with an occasional 3 to 4 ms gap, which is probably garbage collection. With auto-checkpoint on, the import test also passed 1 of 3 runs without the pause: after a commit, the checkpoint's page copy leaves the lock free. Fewer slices make such a gap less likely.

Other tests: `pauses after each slice, at least the least gap` injects the pause. The daemon timer test in `test/code/coverage/prune-main.test.ts` checks that the code prune runs through `startTimers`, and it fails when the code prune is removed from the chain.

## Decisions the spec did not settle

- **Chaining.** The code prune runs in `SlicedPrune.run`'s `then`, as a second `run` with the label `"code prune"`. A failure is still logged as `code prune failed: ...`. A main-prune failure still lets the code prune run. `stop()` ends either prune between slices, and the code store is closed through the generator's `finally`.
- **Busy handling changed.** Before, a busy code store made `SlicedWrites` retry the whole code prune later, coalesced with the timers' other pending groups. Now `SlicedPrune` retries the one busy slice after `busyBackoffMs`, and the busy-wait note names it `pruning`, as it does for the main prune.
- **Vacuum steps** of the code prune now run inside `conn.transaction` (`BEGIN IMMEDIATE`), as the main store's do. Before, `PRAGMA incremental_vacuum` ran in autocommit outside the busy slice.
- **The import's pause** comes after each slice, before the generator reads the next one, so no read the generator makes waits through a pause before its write.

## Type changes

- Added: `CodeStore.pruneSlices(options, counts)`, `CodePruneCounts` (`src/core/code/store/types.ts`), `pruneCodeSlices` and `noCodeRemoved` (`prune.ts`), `pruneCodeSlicesAfter` (`prune-main.ts`), and `turnGapMs` (`write-turns.ts`).
- Optional additions: `SlicedPrune.run`'s third parameter `what` (default `"prune"`), the `pause` field of `SlicedPruneContext`, and the `pause` option of `importSliced`.
- Not additive, internal only: `sweepParts` and `pruneParts` in `parts.ts` are now generators of slices and take a `removed` callback. Their only outside caller was `test/code/coverage/parts-prune.test.ts`, which I updated.
- Unchanged: the 256-row `DELETE_BATCH`, `VACUUM_PAGES`, the store schema, and `KEY_FORMAT_VERSION`.

## Row 011-318 (not fixed here)

The prune's lookup-then-delete race at `prune.ts` (`pruneCoverage`: the keys read, `resultKeys` asked, then deleted in batches) is still open. The pauses widen its window in time, not in kind. The window already spanned many transactions, and another writer could already land between them. Now it lands more often and the window lasts longer.

## For the next worker

- The rig (`holdEvery` with a TEMP trigger, and the waiter thread) fits any other back-to-back write loop. Examples are `removeWorktree` in the main prune, which already pauses, and other writers that #220's research names.
- Squeal's verdict was hard to read on a host at load average 110 to 150. `test/shared/reader-upstream.test.ts` timed out at 5 s with and without the pause, so its failure comes from load.
