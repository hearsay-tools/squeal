# 020-28 worker notes (2026-11-12)

What the slice built, and the seams a next worker needs.

## Flow after the change

1. `collectEvidence` calls `options.ran` after each runner's run (`collect.ts`,
   `tellRan`). The keeper's `ran` now only checks what it may keep
   (`#keepable`: completed, a record, no observed growth, no unkeyed
   environment file, inputs steady during the run) and queues it. No store
   is opened there.
2. `collectWithStores` (`src/cli/code-gate-stored.ts`) returns
   `{ evidence, keep }`. It closes the stores itself only when collection
   throws.
3. `gate()` (`src/cli/code-gate.ts`) pushes `keep` onto `afterReport` right
   after collection. `codeGateCommand` runs `afterReport` in a `finally`,
   so it runs after `io.stdout` got the report, and in the marked child
   after `runAsChild` sent the frame on fd 3.
4. `keep` = `StoredFiles.flush()` (`Keeper.flush`), then `close()`. The
   keyer's `WorktreeKeys` and hasher stay open until `close`, because
   `storeResults` and the re-check need them.
5. `Keeper.flush` re-checks each queued file with `changedSince` against
   the lookup's snapshot (content changes only; a touch after the run does
   not matter), takes the daemon lock, opens both stores and writes file by
   file through `keepFile` (`keep-write.ts`).
6. `StoreWait` (`keep-write.ts`) holds the one 30 s bound. It starts at the
   first `giveUp` call of `slicedWrite`, that is after the first busy try,
   and tells the waiting note then. `spent` builds the exhaustion note.
   Holders come from `lockHolders(database)` of the database that refused
   (`code.sqlite` or `store.sqlite`), with no file descriptor opened.
7. The CLI parent of `--json` (`relaunchGate`) prints the report once the
   frame's length is read, then waits for the child's exit code.

## Decisions the spec did not settle

- The waiting note lists at most 5 paths, sorted, then "and N more".
- After a wait that ended in time, one more note: "the store was free after
  X s: N completed test files kept".
- One run id per runner run, as before; one head read and one revision per
  flush.
- A file whose input changes during the busy wait itself is still written:
  the re-check runs once, before the lock. The key names the bytes the run
  read, so those results stay true for it.
- A `--json` child that dies on a signal after its whole report: the parent
  keeps the printed report and exits 128 plus the signal number (before:
  exit 3 and an empty stdout).

## Tests

- `test/code/gate/keep.test.ts`: queue then flush; lock freed in the bound
  (waiting note with this process as holder, then the "free" note);
  exhausted bound (two notes).
- `test/cli/code-gate-keep-busy.test.ts`: real node:test runs, the holder
  in a second process. No lock; lock freed at the waiting note (JSON and
  plain, report before wait); bound spent (`Date.now` jumps 30 s at the
  waiting note); input changed between report and write; the marked child
  sends its frame before the wait.
- `test/cli/code-gate-relaunch.test.ts`: report printed while the child
  still runs with fd 3 open; signal after the report.

## Not covered here

- A daemon serving the worktree: the note is unchanged ("a daemon runs in
  this worktree, and it keeps its own"), and no new test covers it.
  Row 021-20 later sends these writes to the daemon.
