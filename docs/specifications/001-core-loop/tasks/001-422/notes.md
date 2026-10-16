# 001-422 notes: a busy store delays an edit by the hold, not by the next pass

Wave 17 W1. hearsay-tools/squeal#1, its first criterion. Before this, a pass that met another connection's write lock past the daemon's 5 s busy timeout threw `database is locked`. The edit then waited up to 30 s for the next interval pass, the change feed noted a bare `daemon error: database is locked`, and each heartbeat or expiry write held the event loop up to 5 s.

## What changed, by seam

- **The busy slice (`store/connection.ts`).** `withBusySlice(ms, fn)` and `withBusySliceSync` run `fn` in an `AsyncLocalStorage` context.
  - Inside it, each statement that takes the write lock gets `PRAGMA busy_timeout = ms`, set and restored inside that one synchronous call. These are an outermost `BEGIN IMMEDIATE` and an autocommit `run`. Savepoints and reads are untouched.
  - The slice only shortens a wait. It never lengthens one that is already shorter.
  - Its token is dead once `fn` settles, so async work `fn` started and left running waits the connection's own timeout.
- **The pass (`scheduler.ts`, `handleBatch`).** The ordinary pass (`#pass`, extracted unchanged) runs under `busySliceMs`, which the daemon sets to `BUSY_SLICE_MS` (250 ms).
  - These keep the store's own wait: the awaiting-install branch with its baseline, the moved-paths pass after a tier record (`#reconcilePaths`), and a request's pass (`requestFullSuite` while waiting). They go through `#handleBatch(batch, undefined)`, because nothing retries them.
  - `#pump` and `#tellReinstall` run after the slice, outside its context.
- **The retry (`watcher/batch-retry.ts`, called from `enqueue` in `change-feed.ts`).** A batch task whose error `retry.accepts` (the daemon loop: `isBusy`) runs again as a reconciliation pass of the batch's trigger. The first retry is at once, then each follows `busyBackoffMs` (0, 100, 250 ms, capped).
  - Retries continue until a pass lands, fails with any other error (that one goes to `onError`), or the feed closes. A close during a delay ends the delay at once.
  - The retry runs inside the queue task, so a `reconcile()` caller (`status --wait`) resolves only once the revision is stored. Later batches wait behind it.
  - A pass that failed at `BEGIN IMMEDIATE` changed neither the stat cache nor the ledger: `commitBatch` updates the cache inside the transaction. So the retry finds the same change, and stores it once.
- **The pump (`#stall`, `scheduler/busy-resume.ts`).** With `busyWaits`, a busy error of the pump or of a tier's record does three things: it stops the pump with no note and no `onError`, puts the tier's files back as before, and schedules one `#pump()` after `busyBackoffMs`. It never spins: the delay is ≥ 100 ms after the first, and each attempt waits the store's 5 s.
  - `#requeue`'s commit failing busy notes nothing: the ledger still owes the queue, and the resumed pump's commit writes it.
  - A pending resume keeps the scheduler from counting as idle.
  - A resume with nothing queued still runs one pass of the loop, so its writes end the wait.
  - A non-busy stall is unchanged: one note, and it waits for the next batch or request.
- **The timers (`lifecycle.ts`, `daemon/sliced-writes.ts`).** Four write groups go through `SlicedWrites` with the slice: the heartbeat group (heartbeat, harness check, leaving check), consumer expiry, and prune. Each step waits at most 250 ms.
  - A step that gives up leaves the rest of its group pending.
  - One timer retries every pending group in order, stopping at the first that gives up again, so the timers never stack two slices in one tick.
  - A tick of a pending group is skipped: its retry covers it. A group that ticks while another is pending joins the same retry instead of trying a slice of its own.
  - Any other failure is logged, and the group goes on, as before.
- **One note per episode (`store/busy.ts`, `BusyWaits`).** It counts from the first write that gave up to the retry of the last waiter. Then one note, topic `daemon:store-busy`, so status shows the latest one: `the store was busy for 11.1 s (another connection held its write lock); ran once it was free: the heartbeat, consumer expiry, revision 1`. Its waiters:
  - the pass, named by what it stored (`revision N`, or `a reconciliation pass`);
  - the pump (`N files of a tier queued again`, `the next tier`);
  - each timer group.
- **The daemon's `onError`.** A busy error there was either retried, or already noted by its subject (`could not apply runner work: ...`), so it now goes only to stderr, never as a bare `daemon error: database is locked`. Any other error is noted as before.

## Decisions the brief did not settle

- **Prune** is sliced and retried like the timers, though the contract lists only the heartbeat, harness, leaving and expiry writes. It is a lifecycle timer write, its first run comes 60 s after the timers start (often inside a hold on a busy store), and at 5 s it would break the event-loop bound. Its 87 short transactions resume where the next run finds them.
- **The pump's own writes keep 5 s**, as the contract says for tier records. So the outcome's "never held by one busy wait for more than about 250 ms" holds for the pass and the timers, not for a pump that has a tier to select or record while the lock is held. The test's hold meets an idle pump.
- **The backoff cap is 250 ms, not higher.** At 500 ms a heartbeat landed 722 ms after the lock freed at load 2.4; at 250 ms it was 44 ms and the revision 146 ms. A waiter's duty while the lock is held is at most half the loop: a 250 ms slice, then a 250 ms delay.
- **The episode note has a topic** (`daemon:store-busy`). On cezar's shared store, episodes recur. Without a topic they would push other notes out of the persisted list. With it, status shows the latest, and at most 3 are kept.
- **Short episodes note too.** A heartbeat that met a 300 ms hold gives a note. The contract says one per episode; the topic keeps them from crowding status.
- **The retry is a full reconciliation pass,** as the brief says, not the failed batch again. On a large repository each attempt runs `git status` and stats the tracked paths, about twice a second while the lock is held.

## Tests

- `test/daemon/busy-edit.test.ts` runs a real daemon beside `long-writer.ts` holding the lock once for 12 s. An edit 1 s into the hold must land within 1 s of the lock freeing; so must a heartbeat. Every ping, sent every 100 ms with a 1 s timeout, must be answered. Exactly one busy note must name the revision, with no `database is locked` note.
  - Measured: revision +146 ms, heartbeat +44 ms (load 1.7).
  - On `55ac514a` (src identical to `8737cdc0`) it fails: the revision came 29,163 ms after the lock freed, the next interval pass.
- `test/scheduler/busy-record.test.ts`: the first tier of an edit runs while a second connection takes the lock for 1.5 s, at a 50 ms busy timeout. The pump resumes with no new batch, the edit's state is recorded at its revision, no `scheduler stopped` or `database is locked` note appears, and one busy note names the queued tier.
  - With the busy branch of `#stall` disabled, `idle()` resolves before the release and the test fails.
- `test/store/busy-slice.test.ts`:
  - the slice bounds an autocommit write and a transaction, and restores the store's own timeout;
  - it holds across an async pass's awaits;
  - work left running past it waits the store's own timeout (a worker thread holds the lock);
  - it never lengthens a shorter wait;
  - the episode note.
- `test/watcher/batch-retry.test.ts`: retry at once, then each delay, until a pass lands; any other error reported; a close during a delay ends the retry.
- `test/daemon/sliced-writes.test.ts`: the rest of a group retried, coalesced ticks, a second group behind the same retry, one note, other failures logged, `stop`.

## What remains

- Naming who held the lock (out of scope here; 001-412 "What remains" 2).
- The pump's writes on a busy store still hold the event loop up to 5 s each. Slicing them would also need a retry for runner work (`#drain`, `could not apply runner work`), which still notes a busy error as its subject.
- `markRest` in the unused check and the shutdown's writes keep 5 s.
