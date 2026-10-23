# 011-126: the pump's writes on a busy store stop holding the event loop

Wave 20 W1, worker e8b08f00, from main 56c542f86 (0.1.272). Shape: slice.

## Answer

A tier that records while another connection holds the store's write lock no longer holds the daemon's event loop for 5 s per write. The pump's record, its requeue and the selection (lookups, a tier's start) now wait a 250 ms slice, as a batch's pass does. A record that gives up keeps the run's results and tries again at its turn, so the tier's files do not run again. The results land once the lock frees.

| Measure | Before (56c542f86) | After |
|---|---|---|
| `test/scheduler/busy-hold.test.ts`, the daemon's 5 s busy timeout, a 6 s hold, in process | longest event-loop hold 10,077 ms; the edit's file ran twice | 261 ms; ran once |
| `test/daemon/busy-tier.test.ts`, a 12 s hold from a second process, the slow tier ending 2 s into it | one hold of 10,019 ms from the record's start; note "6 files of a tier queued again" | holds of 250 to 509 ms; the slow file ran once; the edit's revision 55 ms after the free; note "the results of 6 files, the heartbeat, consumer expiry, revision 1" |

The "before" daemon run used `scheduler.ts` and `busy-resume.ts` from 56c542f86 with this row's test (`git show 56c542f86:<path> > <path>`, one run, then `git checkout HEAD -- <path>`). The "after" runs were 4 of 4 passes. The longest hold, 509 ms, is two slices in one tick. Up to three retriers can stack in one tick: the feed's pass, the timers' group and the pump, which comes to about 750 ms. The 1 s bound holds by that margin.

The event loop is still held for most of the hold, in pieces of 250 ms. The record retries as the feed's pass does: a slice, then the backoff pause, and the timers' sliced writes take the gaps. The 011-122 notes describe the same profile for the feed alone.

Pings go to the front desk's worker thread (`src/core/daemon/front-desk.ts`), so they are answered even while the main thread is held. They were answered in the "before" run too. The event loop's holds are read by `test/daemon/stall-preload.mjs`. `NODE_OPTIONS` loads it into the daemon, and it acts only in the daemon's main thread. It logs each gap over 100 ms between ticks of a 10 ms interval.

## What changed

1. `Ledger.commit` (`ledger.ts`, commit 35884f976, coordinator request 7640bfa1, option a). It drained what it owed (dirty files, results, unknowns, retired checks, setup outcomes) before its `BEGIN IMMEDIATE`. So a commit that gave up on a busy store lost those rows: files current in memory stayed queued in `test_file_keys`, and their known states stayed stale. This was so at 5 s already. The 250 ms slice makes it likelier: the selection's trailing commit gives up if another writer takes the lock between the last lookup and the commit and holds it past 250 ms. On a busy error the commit now puts back what it drained, ahead of anything newer (`#drain`, `#putBack`, `SetupFailures.putBack`). Any other error keeps the old behaviour. `test/scheduler/busy-commit.test.ts` was red before the fix (the setup outcome and the key rows were lost) and passes after it.
2. `scheduler.ts` (commit f2ad636af):
   - `#sliced`, `#runSliced`: `withBusySlice(busySliceMs, …)` when the scheduler has `busyWaits`, as the daemon gives it. Without `busySliceMs`, as in the scheduler tests' harness by default, the store's own timeout applies, as before.
   - The selection's `#lock.run` and `#requeue` run under the slice. A busy selection already stalled the pump and resumed through `BusyResume` (001-422). The requeue now runs only after another error, or at the close.
   - `#record` = `#prepare` (once) + `#write` (each try). The preparation re-keys environments (`rekeyEnvironments` sets them in memory, so a second call returns no key changes), hashes observed paths, and counts withholds (`Withholds.record` counts a second call as a second withhold). Repeating it would lose key changes and exhaust a first withhold. `#prepared` and `#written` (WeakMaps keyed by the `EndedRun`) keep both across tries.
   - `#recordLanded`: a busy error waits for `BusyResume.retry` and tries again. Another error, or a busy error at the last try after the close, goes to the old path (stall, requeue).
   - Slots: a slot record whose own write landed returns it on a retry (`#written`), so a busy `SlotRecords` commit only commits again. `#recordSlot` makes the rest of a round give up without a slice once one slot gave up, so the round's slices do not add up.
3. `busy-resume.ts`: `retry(what)` queues a record's turn. Each resume gives the turn to the oldest record. A record that lands passes the turn to the next at once. The pump resumes once no record waits. Records report under their own `BusyWaits` key, so `abandon()` (another error) drops the pump's resume and names but keeps the records' turns. `close()` gives each waiting record its last try, at the store's own wait.

The order of the C7 note stays one note per episode. It names "the results of N files" where it named "N files of a tier queued again".

## Tests

- New: `test/scheduler/busy-hold.test.ts` (the event-loop hold, the single run, the stored result), `test/scheduler/busy-commit.test.ts` (the ledger), `test/scheduler/busy-resume.test.ts` (the turns, `abandon`, `close`), `test/daemon/busy-tier.test.ts` with `stall-preload.mjs` (the done-when's 12 s hold).
- Changed: `test/scheduler/busy-record.test.ts`. Case 1 asserts the new note. Its two or more runs are now the new failure's one re-run (C5), which is pump work after the free with no batch. Cases 2 and 3 (review 001-432 B1) make the selection give up instead of the record: a busy record no longer stops the pump, so it can no longer arm the resume they test. Their claims are unchanged: the resume starts nothing after another error, and an overtaken wait is no news.
- `test/scheduler/helpers.ts`: `busySliceMs` is passed through to the scheduler (additive).
- The edit in `busy-hold.test.ts` keeps `test/math.test.ts` passing. A new failure runs once more by design (`queueReruns`), which would read as a re-run.

## Decisions the spec did not settle

- Records go before the pump at each resume. A record holds a finished run's results, and while it cannot land, a selection cannot land either.
- A record waiting for its turn keeps the tier in flight: its lane stays busy, its files stay `running`, and `idle()` and the close wait for it. The other lead, ending the flight and recording from the pump, would free the lane while its files are still unrecorded.
- At the close the last try is unsliced (5 s), and a busy failure there queues the files for the next daemon, as before.

## Still at the store's 5 s wait

- The slow tier's selection (`SlowTier.next` under its own `lock.run`, `slow-tier.ts`). It could be sliced from the pump (`this.#sliced(() => this.#slow.next(...))`), but I did not check that its slot and activity state survive a busy error midway.
- The runner part's commits (`RunnerWork.drain`, `runner-work.ts`). A busy error there is a background error, not retried, so slicing it would lose the runner work. With the ledger fix such a commit no longer loses its rows.
- `#reconcilePaths` after a record (its pass is not retried), `refreshInstall`, `takeRetries` at start, and `#note`'s `appendNote`.

## Proposed for the spec (spec text is not mine)

C7, D8 paragraph:
- "Past its start, the writes a daemon can retry wait 250 ms instead … the change feed's passes and the heartbeat, harness, leaving, consumer-expiry and prune writes" → add "the tier pump's selection, records and requeues".
- "A busy error of the pump or of a tier's record puts the tier's files back and resumes the pump after the same backoff, with no stall note" → "A busy error of the pump's selection resumes the pump after the same backoff, with no stall note. A tier's record that gives up keeps the run's results, as prepared, and is tried again at its turn, the oldest first and before the pump resumes, so its files do not run again; a waiting record keeps its turn when another error stops the pump, and the close gives it a last try at 5 s."
- "The pump's own writes, the front desk's and the shutdown's keep 5 s." → "The front desk's and the shutdown's writes keep 5 s, and so do the slow tier's selection and the runner part's commits. A ledger commit that gives up on a busy store owes again what it drained (row 011-126)."
- "The tier pump's writes keep the 5 s wait: chained during a hold … (row 011-126)" → "Measured by `test/daemon/busy-tier.test.ts`: with a tier recording 2 s into a 12 s hold, the daemon's event loop was held 250 to 509 ms at a time, against 10,019 ms before; its files ran once, and an edit's revision landed 55 ms after the free (row 011-126)."

## Review 0.1.272 N1

Not done. I did not run the 011-122 probe: the daemon test's stall log gives the measure this row needs. The brief makes N1 a condition for running the probe, and the probe's files (`tasks/011-122/probe/`) are outside this row's ownership. The probe's `instrument.mjs` anchors also predate this row's `scheduler.ts`, so it would fail loudly on the record's anchors before its next run.

## Verification

- `npm run lint`: "Checked 1821 files in 525ms. No fixes applied."
- `npm run typecheck`: `tsc --noEmit`, no output.
- `squeal run --all --wait` at revision 30 (8d22d22bb): checkpoint 3955c391 completed, 926 test files current, 8,765 checks passed, 7 skipped, 4 known failures. All four are the bundle drift checks ("cli/squeal.mjs differs from the build"), which the brief excepts: no `npm run build` in this row.
- Squeal at revision 30: `busy-edit.test.ts`, `busy-record.test.ts`, `busy-hold.test.ts`, `busy-commit.test.ts`, `busy-resume.test.ts`, `busy-tier.test.ts` pass; all 178 files under `test/scheduler/` passed at revision 21.
