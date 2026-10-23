# 015-06 notes: the daemon's code pass

Worker df22339e, 2026-10-24. What 015-07 and 015-08 read, and the choices the spec left open.

## Seam map

| What | Where |
|---|---|
| The daemon's call site | `src/core/daemon/daemon.ts` `#run`: `createCodePass` before the loop; `afterBatch: () => code.nudge()`; one nudge after `loop.start()`; `code.close` after the loop's close |
| The loop's hook | `DaemonLoopOptions.afterBatch` in `src/core/daemon-loop/index.ts`, called once each batch's `handleBatch` settles |
| Lifecycle | `createCodePass` in `src/core/code/pass/index.ts`: opens the code store only while `complexity.enabled` holds, never two passes at once, loads the counter at the first pass with it on |
| One pass | `runPass` in `pass.ts`: work set, files rows, counts, then states, transitions and cursor in one transaction |
| D1's included set | `included.ts` |
| D4's blob lookup and slices | `blobs.ts` (`SLICE_FILES` 200, one file read and counted at a time) |
| D2 and D5 | `judge.ts`, pure |
| The main store's reads | `source.ts` (`mainStoreSource`): revisions, the stat cache's blob ids and sizes, the runners' test files; the scheduler's extra files as the ignored ones |
| 015-05's counter | `counter.ts`, the one file that imports `src/core/code/count/` |
| Code meta | `cursor.ts`: `pass:<worktreeId>` and `recount:<worktreeId>` |

## What 015-07 reads

- **States** (`states`, measure `complexity`): `pass` or `fail` against the threshold the pass judged with, `unknown` for a function in a parse error's range. `countedAt` is the revision of the pass, `changedAt` the revision its outcome last changed. No `pending` row is stored (wave 0, decision 2): a file to count is in `files.uncounted`.
- **Transitions**: `first-seen-fail`, `pass-to-fail`, `fail-to-pass`, `removed`, only from an edit pass. A first count and a recount record none.
- **`recount:<worktreeId>`**: `{ revision, at, reason, threshold }`, with `reason` `first`, `threshold`, `include` or `counter`. Written once a recount's states are stored, in the same transaction.
- **`files`**: every included file, a too-big one with `tooBig: true` and no count. `files.uncounted` leaves too-big files out, so "counting, N of M" ends.
- **Removals**: the pass calls `states.removeMany`; 015-07 changes it to keep view entries (contract point d).

## Decisions the spec left open

1. **The pass follows a cursor, not one revision.** Code meta `pass:<worktreeId>` holds the revision and the policy keys and counter version the states were judged by. Each pass reads every revision after the cursor, so a pass that lags, or revisions made while the policy was off, are caught up at once. A cursor past the newest revision (a new main store) is a first count.
2. **The trigger.** Each batch of the change feed, after its revision is stored, and once after the loop's start. Revisions the scheduler stores outside the feed (the stability check, the install wait) are counted at the next batch.
3. **A first count** is a pass with no cursor, or the first pass after this daemon saw the policy off. It writes the recount key `first` when it counted at least one blob or the daemon saw the switch-on; a first pass over counts it inherits, with no switch-on, writes none (the coordinator's reply, point 3). A daemon that starts with complexity on cannot tell a switch-on while no daemon ran from a new worktree, hence "counted at least one blob".
4. **Reason order.** `threshold`, then `include` (include, exclude or `maxFileBytes`), then `counter`.
5. **Writes.** The files rows go first, so status sees the files still to count. The counts follow, one transaction per slice of 200 blobs. States, transitions, the cursor and the recount key go in one last transaction, so a hook never reads half a revision or half a recount.
6. **The blob lookup** reads each file once per blob, with `O_NOFOLLOW`, and compares its blob id with the stat cache's. A file whose bytes moved since is kept as it was and read again at the next pass (in memory only). A file the counter throws on stays uncounted and is logged. A symlink is not counted at its own path.
7. **Moves** pair a check gone from the work set with an added one of the same body hash, a check of the same file first, in source order. The old body hashes come from the count the old files row names, so no body hash is stored in `states`.
8. **`unknown`** records no transition in or out. Its value is the count the parser gave.
9. **A file that grows over `maxFileBytes`**, or is deleted, removes its states, with `removed` for a failing function. A recount that excludes a file removes them with no transition.
10. **A file a runner lists later.** A new test file can be counted at its own revision, before the runner part lists it. The next pass drops its rows (an edit pass records `removed` for a failing one).
11. **Errors.** A pass that throws is reported once until a pass succeeds, so a counter that cannot load is one note, not one per edit. A busy store error goes to the log only, as the loop's.
12. **A corrupt code store** is deleted with its `-wal` and `-shm` and made again (wave 0, decision 12). A newer one is left alone and logged once.

## Type changes

- `CodeFile.tooBig?: boolean` in `src/core/types/code.ts`, and the `files.too_big` column in V1 (contract point c). Reads set it only on a too-big row, so wave 0's `toEqual` tests hold.
- New, in `src/core/code/pass/types.ts`: `Counter`, `SourceFile`, `PassSource`, `RecountReason`, `RecountRecord`, `PassReport`.
- `DaemonLoopOptions.afterBatch?: () => void`.

## Measured

- With 015-05's counter (commit 5c26d45b8) over this repository's 625 `src/` files: the first count took 2.16 s wall and 2.43 s CPU, at load 42 to 53 (goal 8: at most 5 s CPU). It found 7,212 functions, 57 over 20 and none `unknown`. A second worktree at the same blobs counted nothing, in 120 ms.
- 300 changed files with a fake counter of 3 ms of CPU each: 1.23 s. The longest stretch without a turn of the event loop was 32 ms, and a hook's connection with no busy wait wrote 2,383 times during the pass. With the files read in parallel it was 228 ms, hence one file at a time.

## For the next rows

- **015-08** gets `PassReport.edited`: the checks whose identity stayed and whose body hash changed. Nothing stores it yet; the pass returns it to `onPass`, which the daemon does not set.
- **Prune.** No caller runs `CodeStore.prune` yet. The daemon's prune of the main store is the place, with the live worktrees and consumers read after it (wave 0, decision 14).
- **Large repositories.** A recount writes every state in one transaction: about 7,000 rows here. A repository a hundred times larger would hold the code store's write lock for seconds.
- **Status's "counting".** During a first count the files rows exist before the counts, so `files.uncounted` gives "N of M" as the slices land.
