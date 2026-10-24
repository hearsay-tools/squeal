# 011-137: a daemon that steps down for newer hooks keeps its running tier's work

Worker fc86484d, wave 28 W1, from main at e9c424d3d (after 0.1.286), 2026-10-24. Shape: survey, then slice.

## 1. Survey: what a step-down's cancel kept

### Sources

- A copy of this host's store, `<common-dir>/squeal/store.sqlite` with its `-wal` and `-shm`, taken 2026-10-24 05:16Z into the worker's scratch directory. Read only there.
- The run directories beside it (`runs/<run id>/report.json` and `vitest.log`), read in place.
- The scripts are in the worker's scratch directory, not in the repository: `runs.mjs`, `successors.mjs`, `fates.mjs`, `complete.mjs`, `table.mjs`. Each reads the copy and the run directories, and writes nothing.

### What is left to count

The prune has removed most runs of 22 October: the store keeps 86 runs that started that day and 840 of 23 October. Ten runs whose report fails with `run cancelled: the daemon stepped down for newer hooks` are left. Nine started on 22 October (UTC) and one on 23 October at 04:02Z. Eight of the ten are inside the 24 hours that `research/host-load/2026-10-23.md` counted (07:00Z on 22 October to 07:00Z on 23 October); the two runs of `998aca77` started 20 minutes before that window. All four worktrees were removed later, so their revisions, keys and notes are gone. Their runs and their results that a live worktree's key holds are kept (001 D8, `src/core/store/prune.ts`).

The research's 2,502 files are therefore not here to count again. The ten runs below are a sample of the same cause.

### Each cancelled tier

"Ended before the cancel" is the report's `completedFiles`: the modules that Vitest reported as ended before the cancel was asked (`endedInTime`, `src/runners/vitest/reporter.ts`). "Ended in the grace" is a `MODULE` line after the run log's cancel note: the module ended in the 1 s before Vitest's forced cancel, and the report drops it (`afterCancel`). The run log prints no skipped test, so "all tests run" is inferred: the module's distinct `PASS` and `FAIL` names cover the tests the file stored at its key nearest to the run, less its skipped ones. "Never ended" is the rest of the tier: not started, or cut by the forced cancel. The last three columns read the next run of the same worktree, which the successor ran.

| Run | Worktree | Start (UTC) | Wall s | Picked | Ended before the cancel | Ended in the grace | of them all tests run | cut | failed | Never ended | Successor's first run after s | Of the unfinished it ran | Of the finished it ran |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| d53b00b1 | 998aca77 | 10-22 06:36:37 | 18.5 | 200 | 77 | 9 | 0 | 8 | 1 | 114 | 76.2 | 50 of 123 (tier 200) | 0 |
| a02b1e9c | 998aca77 | 10-22 06:38:11 | 4.9 | 200 | 84 | 12 | 7 | 2 | 3 | 104 | 14.4 | 116 of 116 (tier 200) | 0 |
| 2f1df763 | f6b7b547 | 10-22 11:20:36 | 8.0 | 200 | 118 | 12 | 8 | 4 | 0 | 70 | none kept | | |
| 7485cc3e | e34fc3f1 | 10-22 13:52:29 | 6.2 | 200 | 66 | 11 | 6 | 3 | 2 | 123 | 43.4 | 134 of 134 (tier 200) | 0 |
| 18620313 | e34fc3f1 | 10-22 13:53:19 | 50.7 | 200 | 184 | 8 | 0 | 8 | 0 | 8 | 24.3 | 16 of 16 (tier 46) | 0 |
| c8504266 | e34fc3f1 | 10-22 13:54:34 | 14.1 | 46 | 13 | 11 | 0 | 11 | 0 | 22 | 21.5 | 33 of 33 (tier 34) | 1 |
| 175abadf | e34fc3f1 | 10-22 13:55:09 | 25.6 | 34 | 12 | 9 | 0 | 9 | 0 | 13 | 34.0 | 22 of 22 (tier 23) | 0 |
| 352de9d1 | e34fc3f1 | 10-22 13:56:09 | 36.2 | 23 | 11 | 8 | 0 | 7 | 1 | 4 | 355.7 | 12 of 12 (tier 12) | 0 |
| e3a84aca | e34fc3f1 | 10-22 14:02:41 | 76.9 | 12 | 11 | 1 | 0 | 1 | 0 | 0 | 152.0 | 1 of 1 (tier 1) | 0 |
| 2f73cc36 | 6d45a893 | 10-23 04:02:31 | 23.7 | 200 | 63 | 15 | 0 | 15 | 0 | 122 | none kept | | |
| all | | | 264.8 | 1,315 | 639 (49%) | 96 (7%) | 21 | 68 | 7 | 580 (44%) | | | |

*read from store and run logs; "all tests run" inferred.*

### Findings

1. **The files that ended before the cancel kept their results.** The successors ran 1 of those 639 files again (`c8504266`'s, in `175abadf` at revision 1). On 22 October Squeal's own baseline was still the default, which queues every miss at a daemon's start, so a finished file with no stored result would have run again. For `e34fc3f1`, whose keys live worktrees still hold, the store still has the results of 281 of the 297 finished files under the cancelled run's id. *read from store; that the other worktrees' finished files stored is inferred from the successors.*
2. **The unfinished files ran in the successor from the handed-over queue.** In 6 of the 7 tiers with a kept successor, the successor's first run held every unfinished file (011-33's handover). The exception is `d53b00b1`: its successor's first tier of 200 held 50 of its 123 unfinished files, the second 41, and 32 ran in no kept run. Why is not determined: the worktree's revisions and key rows are pruned. *read from store.*
3. **What the cancel loses is the files in flight.** 96 files (7% of picked) ended in the grace after the cancel, and the report dropped them all. About 21 of them had run every test before the cancel reached their worker, so their results were whole and valid; the successor ran them again. 68 had tests cut by the cancel and 7 failed. Vitest reports a cut module as `passed` (its cut tests are `skipped`), so a module's state does not tell whole from cut. *read from run logs; the split inferred.*
4. **The research's figure is mostly files that never started.** 580 of the 1,315 picked files (44%) never ended: at most one file per worker is in flight, so most of them never started. They cost no run time (`research/stored-nothing.md` finding 1, the tight bound) and the successor runs them from the queue, but a count in files reads them as lost. So by file count, no cancel can bring a step-down under 2% of picked files: only a count that reads a cancelled tier's files that never started as handed over can (`research/probes/host-load/waste.mjs` counts them 0 s and one file each).
5. **One worktree stepped down six times in 11 minutes.** `e34fc3f1` ran six tiers from 13:52 to 14:03Z, and a step-down cancelled each one, so its unfinished files were picked up to four times. The step-down notes are pruned, so the versions are not known. This matches the loop of gh-77 that row 011-151 closed in 0.1.279. *read from store; the cause inferred.*
6. **The successor's first run came 14 s to 356 s after the cancelled run ended**, median 34 s. That time includes the successor's lock wait, its start and its baseline lookup, so it is not the successor's start alone.

## 2. The slice

From findings 1 to 3, the step-down already keeps what ended before the cancel and hands over the rest. The result it still loses is that of a file that ran every test and whose module ended in the cancel's grace. The slice keeps it.

- **The rule.** Under a step-down's cancel, a module that ends in the grace counts as completed when its state is `passed` and none of its tests that were to run (collected mode `run` or `only`) ended `skipped` or `pending`. A test the cancel cut reads so. The probe below shows this. A failed module, or one with a cut test, stays unfinished and queues for the successor, as before.
- **No delay.** The grace stays as it is (`GRACE_BEFORE_FORCE_MS`, 1 s, then the forced cancel). The successor starts no later.
- **What a stop does is unchanged** by default: the rule is gated on the cause `step-down`. Request to the coordinator below.

### Probe: what the main thread sees of a cancelled module (Vitest 5.0.3)

Scratch project, `createVitest` with a reporter that prints `onTestModuleEnd`, `cancelCurrentRun` at 900 ms:

| Test | `options.mode` | `result().state` |
|---|---|---|
| ended before the cancel | `run` | `passed` |
| running at the cancel (a 1.5 s wait) | `run` | `skipped`, note "The test run was aborted by the user." |
| after it in the same file | `run` | `skipped`, same note |
| `it.skip` | `skip` | `skipped`, same note |
| `ctx.skip()` inside the test | `run` | `skipped`, no note |

Each of those modules ended `passed`. A file with one passing test and a 1.5 s `afterAll` ended `passed` with the test `passed`. With 2 workers, files that never started reported no module end. So a test that was running at the cancel never reads `passed`: Vitest marks it skipped and does not wait for it. A `ctx.skip()` reads as a cut test, so the rule keeps no module that skips itself at run time after a cancel. That costs a run, never a wrong result.

## 3. Proposed C9 text

After "Results the runner already stored stay, under the stability check.":

> Under a step-down, a Vitest module that ends in the cancel's grace stores its results too, under the same check, when it passed and the cancel skipped none of its tests: those tests ended before the cancel reached their worker (amended 2026-10-24, row 011-137, `tasks/011-137/notes.md`: of 1,315 files that ten step-downs cancelled on 22 and 23 October, 639 ended before the cancel and kept their results, 96 ended in the grace and were all dropped, about 21 of them whole).

And in C4 step 5, after "the files whose module ended before the cancel keep their results under the stability check below,":

> and under a step-down also those whose module ended in the grace with every test run (C9),
