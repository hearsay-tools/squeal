# 011-120: a cancelled forced run stays forced only while what forced it still holds

Worker notes, wave 21 (W1), from main `7580d1a1d` (0.1.273). Commits `4648de5e4`, `1427c1f73`, `786599d5e`.

## 1. The row's defect, reproduced and fixed

`recordTier`'s `requeue` branch (`src/core/scheduler/tiers.ts`) queued a cancelled tier's file again with the tier entry's `forced`, also after a revision had moved the file's key. `Ledger.settle` skips the lookup of a forced entry, so after a revert the file read current but stayed `queued`, and `run --all` listed it (`tasks/011-118/notes.md` 2).

Reproduced on main by `test/scheduler/forced-requeue.test.ts`, first case, with temporary log lines in `recordTier` and `settle`, as in 011-118's probe:

```
PROBE decision test/lists.test.ts requeue forced true ran 72eec0 now 436877 cancelled true
PROBE forced skip test/lists.test.ts 5207a7
```

`5207a7` is the key of the stored pass. On main the test fails at `expected 'queued' to be null`.

Fix: `Ledger.staysForced(file, key, forced)`. A forced run that stored nothing is queued forced again only while the file is at `key`, the key the tier ran it at, or while the open checkpoint holds it strict (`checkpoints.covers([ref], true)`, `run --all --force`). Otherwise the file is queued as any miss (001-171 S1). These call sites use it:

- the `requeue` decision: a cancel cut the run short, a first withhold, or the install moved (001-107; it is the same branch);
- `requeueSplit` (`timeout-split.ts`), which now takes the key the tier ran;
- `Ledger.discard` (withheld and unstable runs), which had `forced && file.key === key` and now also keeps a strict file forced;
- a not-started file of another project after a startup failure (`notStarted` in `recordTier`, re-queued by `failStartup`).

## 2. Found and fixed: a stored pass at the moved key counted for a strict checkpoint

The `requeue` fix alone did not make done-when 2 true when the new key already had a stored result. Probe: a `run --all --force` holds `LISTS` at K0; an edit moves it to K1, where a pass is stored. A temporary log line in `settle`'s hit branch printed:

```
PROBE hit test/lists.test.ts be30ab running 5207a7 checkpoint f867781f-… strict true
```

`settle` looked the running file up at K1 and applied the hit with `checkpointId = idFor(ref)`, the strict checkpoint's id, so `checkpoints.done` counted it. `recordTier` then found the tier `superseded` (`resultKey === file.key`), so nothing was queued again, and the file never ran forced at K1. Without the fix, the forced case of `forced-requeue.test.ts` fails at `expect(doneOf(h)).toBe(done)`: `expected 1 to be +0`.

## 3. Found and fixed: a strict checkpoint hung when its running file went back to its results' key

The same `settle` branch also covers a file back at `resultKey`: it calls `checkpoints.done(ref, null)`, which a strict checkpoint does not count, and removes the file from the queue. The tier in flight is then `superseded`, so nothing queues the file again. Probe: `test/scheduler/strict-lookup.test.ts`, second case, without its phase assertion, on the code before `1427c1f73`, logging after `idle()` (the test's name and one field that read a wrong meta key are left out):

```
{"end":null,"runs":1,"phase":null}
```

The checkpoint never ends. The file ran once, and that run was cancelled. Nothing is queued.

Fix (`1427c1f73`, coordinator decision (a), 2026-10-23): in `settle`, a file the open checkpoint holds strict that runs at another key takes no lookup and no back-to-`resultKey` shortcut. It is queued forced at the new key, whatever `queueMisses` says. A file that no strict checkpoint holds keeps both paths unchanged: `strict-lookup.test.ts`, first case (a lookup at a moved stored key completes a `run --all` at once), and `checkpoint-lookup.test.ts` (row 011-118, back at `resultKey`).

## 4. Seam map

Where `forced` comes from:

- `checkpoint-requests.ts:78` and `:142` (`run --all --force`, and a resumed strict checkpoint);
- `rerun.ts:109` and `:162` (001-171 re-run, a re-run restored at start);
- `retries.ts:75` (the agent's retry, 001-348).

`settle` drops the non-strict kinds itself when the key moves: `rerunPending && key !== rerunKey` ends the re-run, and `lapseRetry` ends the retry. Then it skips the lookup of what is still queued forced. Only a re-queue after the run ended could put `forced` back at a moved key. Section 1 lists the four re-queue sites.

## 5. Test harness notes

- A revision cancels a fast tier by supersession only when it changes an exact input path of every unfinished file (`yields.ts` `superseded`). In this harness, an add under `tree/` (011-118's swap file) did not cancel a re-run whose input was the listing `tree/`: the run completed, and `discard` read it as `unstable`. So the tests edit `tree/a.txt`, which the test file reads. 011-118's probe saw a cancel with the swap file; these notes do not explain that difference.
- To land the revert between the cancelled run's record and the next tier selection, the first test spies on `store.runs.finish`. When the held run's record finishes, the spy hands `handleBatch` a batch stat'ed synchronously (`statNow`). `Mutex` is FIFO, so the batch takes the lock before the pump's next selection.
- A `run --all --force` requests every file of the repository, so the checkpoint's `end` alone does not show that one file's lookup was counted. `doneOf` reads the published progress (`done`) before and after the revision.
- The fixture runs one file a tier (`tierSize: 1`), so a revision that moves `LISTS`'s key cancels its tier alone.
