# 011-339 notes: one owner for each daemon progress record

Worker 172d5173, wave 91 W1, 2026-11-14. Spec: `research/progress-records.md`.

## Owners

The proposed names are kept. Each owner imports only `types/common`, `types/scheduler` (types only) and `types/store`. Each keeps its key builder private. No owner opens a transaction.

| Record | Owner | Reads | Writes |
|---|---|---|---|
| refined revision | `src/core/scheduler/refined.ts` | `readRefined`, `isRefined(revision)`, `covers(refined, revision)` (pure, for a reader that needs the value and the answer from one read) | `recordRefinedApplied` (sets), `recordRefinedFailed` (raises only) |
| install wait and its command | `src/core/scheduler/install-wait.ts` | `readInstallWait` → `{ workspaces, command }` or `null`; the command is read only while it waits | `recordInstallWait(workspaces, command)`, `endInstallWait` |
| checkpoint progress | `src/core/scheduler/checkpoint-progress.ts` | `readCheckpointProgress` | `writeCheckpointProgress(progress \| null)`; `null` stores `""` as before |
| head move | `src/core/scheduler/head-move-record.ts` | `readHeadMove` | `writeHeadMove` |
| bootstrap marker | `src/core/daemon/bootstrapped.ts` | `lastScannedBy` (the `startedAt` of the daemon that last finished its scan; `null` when absent or not finite), `scannedBy(startedAt)` | `markScanned(startedAt)` |
| notes | `src/core/notes.ts` (key now private there) | `readDaemonNotes` (unchanged) | `appendNote` (unchanged), new `storeNote(meta, …)` for the raw table of a newer store |

Types kept in `types/scheduler.ts`: `CheckpointProgress`, `OwedCheckpoint`, `HeadMove`, `DaemonNote`, `MAX_PERSISTED_NOTES`. Removed from `types/`: `notesMetaKey`, `refinedMetaKey`, `awaitingInstallMetaKey`, `installCommandMetaKey`, `awaitingInstallValue`, `parseAwaitingInstall`, `checkpointMetaKey`, `parseCheckpointProgress`, `headMoveMetaKey`, `parseHeadMove` (`types/scheduler.ts`), `bootstrappedMetaKey` (`types/daemon.ts`). `WORKTREE_META_ROWS` names the owners: `notes`, `scheduler/refined`, `scheduler/install-wait` (two rows), `scheduler/checkpoint-progress`, `scheduler/head-move-record`, `daemon/bootstrapped`.

## Moved call sites

Every write stays at its call site and in its transaction; every read at its point.

Refined revision:
- write `scheduler/ledger.ts` `Ledger.commit`: `recordRefinedApplied`, inside the commit's `store.transaction`.
- write `scheduler/refine-apply.ts` `recordRefined`: `recordRefinedFailed`, inside its own `store.transaction` (the function's, as before; retried while busy as before).
- read `state/header.ts` `readHeader`: one `readRefined`; `runnerPartPending = !covers(refinedRevision, revision)`. One read, as before, with the same comparison the header made by hand. (Commit 19197a9ae's note that the header read it twice described this branch's first commit only; the baseline read it once.)
- read `scheduler/bootstrap.ts` `scan`: `readRefined(…) ?? latest ?? 0`. Its private copy is deleted.
- read `delivery/edits.ts` `editNotes`: `!isRefined(store, wt, revision)` replaces `refined(…) < revision` with its +Infinity default. Same answer.
- read `scheduler/rekeyed-moves.ts` `nextMoves` (caught-up check) and `answerMoves` (`refining`): `isRefined`. Its private `refinedRevision` is deleted.

Install wait:
- write `scheduler/install.ts` `recordWait`: `recordInstallWait`. Its callers are unchanged: `startWaiting` (inside its `store.transaction`, before the ledger's commit) and `reconcileWaiting` (no transaction, as before).
- write `scheduler/install.ts` `stopWaiting`: `endInstallWait` (stores `"false"`, as before).
- read `state/header.ts` `readHeader`: `readInstallWait`. The command is now read together with the wait, a few lines earlier in the same synchronous `readHeader` call, and still only while it waits. `installCommandField` is deleted.
- read `cli/wait/progress.ts` `installWait`: `readInstallWait`. Interface (`InstallHold`) unchanged.

Checkpoint progress:
- write `scheduler/checkpoints.ts` `CheckpointTracker.#write`: `writeCheckpointProgress`. The tracker still skips a write equal to its last one; it keeps that last one as JSON (`null`: ended, `undefined`: none yet), so the first write, an end included, still writes.
- read `scheduler/checkpoints.ts` constructor (`#left`), `cli/wait/progress.ts` `openCheckpoint`, `cli/warmup.ts` progress line, `status/snapshot.ts` `openCheckpoint`: `readCheckpointProgress`.

Head move:
- write `scheduler/head-move.ts` `recordHeadMove`: `writeHeadMove`.
- read `scheduler/head-move.ts` `knownHead`, `state/revision-commit.ts` `readRevisionCommit`, `code/pass/source.ts` `headAt`: `readHeadMove`. Each keeps its own comparison (below).

Bootstrap marker:
- write `daemon/daemon.ts` start, the "start's scan mark" busy write: `markScanned`.
- read `cli/retry-unlisted.ts` `unkeyedPath`: `lastScannedBy`, read into `scanned` before `store.revisions.get` of the listed revision, as the baseline read the marker before the revision. No read transaction holds the two together, so the order is part of the output (review 0.1.491 B1: the first commit read it after, and a daemon's scan committed between the two reads turned `Not listed yet`, exit 3, into `Not retried`, exit 1). Before: `Number(marker)` filtered to finite; same value. Regression case: `test/cli/retry-unlisted.test.ts` "a scan and key another connection commits between the two reads leave the path unlisted", a second store connection committing the key and the scan marker inside `revisions.get`; checked failing with the reads swapped (1 failed, 6 passed) and passing with the fix (7 passed).
- read `delivery/registered.ts` `scannedDaemon`: `scannedBy`. Before: `Number(marker) === startedAt`; same.

Notes:
- `core/notes.ts` `appendNote`, `readDaemonNotes`: key now private.
- `daemon/notes.ts` `noteInNewerStore`: writes through `storeNote` over the raw table, between its own `BEGIN IMMEDIATE` and `COMMIT` as before; no ANSI strip, as before.

## The head move's two readings (asked by the brief)

The code pass (`headAt(N)`) takes a move only at exactly revision N; the header (`readRevisionCommit`) and `head-move.ts` (`knownHead`) take one at N or later.

The difference is deliberate: the two ask different questions.
- `headAt(N)` asks for `HEAD` at the end of a past revision N. A move recorded at a later revision M happened while M was the latest, so after N ended; it does not describe N.
- The header and `knownHead` ask for the `HEAD` now, at the latest (or the ledger's) revision. A move's revision is the ledger's revision when it was seen, so it is never above the latest revision in practice, and `>=` reads as `==` there. `>=` only makes a move recorded after a revision the store no longer has as latest still count as the newest observation.

No row is proposed.

## Rule and value edges kept

- `recordRefinedFailed` keeps the raw comparison `!(Number(stored) >= revision)`, so a stored non-whole number still behaves as before on that path. `readRefined` keeps `Number(raw)` integer-or-null, so a stored `""` reads as 0, as all four readers did.
- `recordInstallWait` always writes the command, as `startWaiting` always did. A test that stages a wait from a daemon before task 001-410 (no command row) writes the wait row raw through the registry (`test/cli/run-group-wait.test.ts`).

## Tests

New: `test/scheduler/progress-records.test.ts`, the table test at the owners' interface over `freshStore()`: per record, writes in, reads out, another worktree untouched, a missing value and unreadable values; for the refined revision a lower value after a higher one under each write rule (the set lowers it, the raise does not), and a raise over an unreadable value.

Deleted parser-only test cases: none existed as cases of their own. The parsers were called only as helpers inside behaviour tests (`checkpoint-tracker.test.ts` "Checkpoints: join, owe and resume", `drain-checkpoint.test.ts`, `forced-requeue-fixture.ts` `doneOf`), and `awaitingInstallValue` only to stage rows. Those calls now go through the owners. Two assertions on the stored ended value changed by rote from `meta.get(key) === ""` to `readCheckpointProgress(…) === null`: `test/scheduler/checkpoint-tracker.test.ts` "keeps the open checkpoint's progress in meta, and clears it once it ends" and `test/scheduler/checkpoint-lookup.test.ts`; the table test pins the stored `""`.

Changed by rote: every test file that wrote one of these rows raw now writes through the owner (`recordRefinedApplied`, `recordInstallWait`, `writeCheckpointProgress`, `writeHeadMove`, `markScanned`); raw reads go through `readRefined`, `readCheckpointProgress`, `readHeadMove`, `lastScannedBy`. Exceptions, through the registry key (`worktreeMetaKey`), which stage or read a stored form no owner write produces:
- `test/harness/stop-no-edit.test.ts`: deletes the marker (no owner event removes it);
- `test/cli/run-group-wait.test.ts`: a wait with no command row;
- the notes raw reads (`test/notes.test.ts`, `daemon/helpers.ts`, `daemon/lifecycle.test.ts`, `runners/*`, `scheduler/*` notes helpers, `presence/io.test.ts`): they read the stored list itself, which `readDaemonNotes` folds by topic.

## Not done here

- `pnpm run build`: not run (brief). The coordinator rebuilds the hook bundles; the owners import no scheduler code, so the header bundle takes in no new scheduler module beyond the owner files themselves (`scheduler/refined.ts`, `scheduler/install-wait.ts`, `scheduler/head-move-record.ts`, all types-only imports).
- `test/keys/key-format.test.ts`: moved code in `src/core/scheduler`; the coordinator runs it with the gate.
