# 001-412 notes: "daemon error: database is locked" on cezar's shared store

Wave 15 W2. Fix: `38499006`. Test: `test/scheduler/idle-lock.test.ts`.

## What logged it

- **Two daemons, 13 s apart.** In the status of cezar's worktrees (read-only `squeal status --json` in each, 0.1.168) the note appears twice:
  - `agent-a06e3c59f05774c4a` at 08:27:46.205Z, revision 12;
  - cezar's main checkout at 08:27:59.373Z, revision 79.
  - Both daemons were idle. Main sat at revision 79 from at least 07:56Z to 19:31Z.
- **Bare note, so the change feed.** `daemon error: <message>` is the loop's `onError` (`daemon.ts`, `createDaemonLoop`). Every scheduler error path (`#stall`, `#backgroundError`) first persists a prefixed note: "scheduler stopped running tiers: ...", "could not apply ...". Neither note exists. The only callers that report bare are the change feed's queue (`change-feed.ts`, `enqueue`), where `scheduler.handleBatch` threw, and `setExtraFiles`.
- **The interval pass.** With no edits, the throwing batch was the 30 s idle reconciliation pass (`reconcileIntervalMs`).
- **What an idle pass took on main.** Logged with a preload over `DatabaseSync.exec` on a scratch daemon (`/tmp/w2-412/txall.txt`), every 30 s:
  1. `takeHeldFiles` (`held.ts`), from `Ledger.confirmHeld`, a `BEGIN IMMEDIATE` even with nothing held;
  2. `reconcileBatch`'s `store.transaction` (`batch.ts`), even with no change and no stat-cache update;
  3. the pump's `selectTier` → `Ledger.commit()` with nothing to write.

  Every idle daemon on a shared store took the write lock three times a pass. One that met another holder for more than its ready busy timeout (5 s, `DAEMON_BUSY_TIMEOUT_MS`) threw at the first of them.

## What the daemon did next

- **It carried on.** The note was persisted, so the lock came free within the next 5 s. Both daemons kept heartbeating and noting for hours.
- **The pass was lost, and nothing else.** `BEGIN IMMEDIATE` failed before any write or ledger change. The next pass, 30 s later, re-ran it.
- **For an active daemon the same failure delays an edit.** A pass that has a change does need the lock. If it throws, the change waits for the next interval pass, up to 30 s, and the same note is written. Not fixed here; see "What remains".

## Reproduction on main, and the fix

- **Scheduler level:** `test/scheduler/idle-lock.test.ts`. A second connection holds `BEGIN IMMEDIATE` and the store's busy timeout is 50 ms.
  - On `a439bbb9`, the idle `interval` pass threw `database is locked` from `takeHeldFiles`.
  - With only the first two writes removed, the pump stalled instead ("scheduler stopped running tiers: Error: database is locked") from `selectTier` → `Ledger.commit`.
  - With all three removed, it passes, and an edit after the hold records its revision.
- **Daemon level:** scripts in `/tmp/w2-412/scripts` (scratch only).
  - Setup: `repro2.sh` starts a real daemon in a one-file scratch repo. Two writers (`test/daemon/long-writer.ts`) take turns on the write lock, 12 s held and 1 s free, for 100 s.
  - Baseline `a439bbb9` build: `daemon error: database is locked` noted in 3 of 3 runs (17:55Z, 18:01Z, 18:03Z).
  - Fixed build: 0 such notes in 3 of 3 runs. Heartbeats and consumer expiry still fail on stderr, as before; they are not notes.
  - With 7 s holds the baseline did not reproduce in one 75 s run: the waiter gets in during the 1 s rests, and a hold has to cover a pass's whole 5 s wait.
- **The fix** (`38499006`). Each write reads first and writes only when something changed:
  - `takeHeldFiles` returns at once when nothing is held.
  - `reconcileBatch` skips the transaction for a diff with no changes and no updates. `recordHeadMove` still runs for a non-watch pass.
  - `Ledger.commit` returns without a transaction when nothing is owed and the moves record would not change. `movesWouldChange` in `rekeyed-moves.ts` is `recordMoves` without the write. The first commit of a ledger (`#adopted` false) and a `refined` commit always write.

## Who held the lock ≥ 5 s: not named

Measured on a scratch copy of cezar's store (`node:sqlite` `backup()` read-only, 196 MB, 18 worktrees, 281,146 known states, 117,823 results), with the real `prune` and `worktrees.remove` from this tree:

- Removing the largest worktree (18,055 known states) took one transaction of 398 to 429 ms.
- `prune` took 4.5 to 5.3 s in total, as 87 transactions. The longest was 445 ms (`DELETE FROM runs`); each `dropPrunable` batch took 100 to 221 ms.
- A waiter writing every 500 ms beside that prune waited at most 835 ms; it never failed.
- A real daemon starting on a fresh clone of cezar against the copy (lookup-only, as cezar's config) held nothing over 544 ms. Its keys missed, so its lookups did less than an agent worktree's do.
- The runs table around 08:27:59Z holds:
  - a `tfs-1056` tier of 4 files, from −25 s to +4.4 s;
  - a run of the same worktree whose `report.json` was written 20.7 s before its `ended_at` (`d6f1b0e4`, −45.8 s to −25.1 s);
  - `agent-ae36f47254b9d5b33`, registered at −415 s, whose revision 1 came at +48 s.

  None of these is shown to hold the lock for 5 s. The host's load that day was 40 to 145; any of them stretched 10 times would. Since the fix, idle daemons no longer meet such a holder at all.

## What remains (for a row)

1. **An edit's pass on a busy store.** A pass that has a change and meets a holder longer than 5 s still notes `daemon error: database is locked`, and the edit waits up to 30 s for the next pass. A busy error in the change feed's task could re-run the pass soon, with a note naming the store as busy.
2. **The ≥ 5 s holder.** To name it, a busy failure could note which daemons were in what phase, or each daemon could log write holds over 1 s.
3. **Other periodic writes still take the lock on an idle daemon:**
   - the heartbeat (every 5 s, autocommit);
   - consumer expiry (every minute);
   - `dropGoneHarnesses`;
   - prune.

   They fail only to stderr (`heartbeat failed`, `consumer expiry failed`), not as notes. Each blocks the event loop for up to its 5 s busy wait, synchronously.
4. **Possible test race, seen once.** `test/daemon/unused-stop.test.ts:100`, "stops a daemon whose consumer stays registered...", failed once in Squeal at load ~25: `ping` answered while the worktree's daemon record read null. It passed 3 of 3 alone. Not this row's code. It looks like a race between the new daemon's socket answering and its registration.
