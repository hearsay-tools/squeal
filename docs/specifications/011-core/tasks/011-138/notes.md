# 011-138: the daily measurement counts the files a cancelled run never started

Worker fc86484d, resumed by the wave 28 coordinator after row 011-137, 2026-10-24. Shape: slice (measurement). The row as rescoped on the board at main 24cec018d: the 011-137 survey's finding 4 goes into `research/probes/host-load/waste.mjs`.

## 1. What changed

| Where | What |
|---|---|
| `research/probes/host-load/waste.mjs` | From each cancelled run's `vitest.log` (a report `failure` that starts `run cancelled`), a picked file that the log never names did not start. Each `files` share (`all`, `live`, `removed`, `checkpoint`) gives `neverStarted`, `handedOver` and `keptShareStarted` beside `keptShare`. A new `cancelled` table gives per cancel cause, over all runs: `runs`, `withoutLog`, `picked`, `neverEnded`, `neverStarted`, `handedOver`. |
| `research/probes/host-load/README.md` | A section "Files that never started (row 011-138)" names the fields and says that C3 and its criteria row are unchanged (the 011-114 criteria are the human's). "Report these too" names the three `all.files` fields, with no target. |

C3 is unchanged. `keptShare` and every field the script printed before give the same values on the same copies (section 3).

### The rule

- **Named.** A log names a file when a line is a module end (`MODULE <state> <label>`), a test line (`PASS`, `FAIL` or `SKIP <label> > …`) or a console line (`[stdout] <label>: `, the label JSON-quoted when it holds `: ` and similar). The label is `[<project>] <path>`, or the path alone without a project (`testFileLabel` and `consolePrefix`, `src/core/run-log.ts`).
- **`neverStarted`.** A file the cancelled run picked that its log does not name. A cancelled run with no `vitest.log` counts none (`withoutLog`). In today's copies every cancelled run has a log: the 764 cezar run directories that hold a `node-test` log have no `report.json`, so none of them reads as cancelled.
- **`handedOver`.** Of the `neverStarted` files, those that a later run of the same worktree picked: any run in the copy that started after the cancelled one, also after the window's end.
- **`keptShareStarted`.** (`storedNow` + `prunedWithWorktree`) of (picked − `handedOver`). A never-started file holds no result, so it is always in `storedNothing` (section 3, check 4), and only the denominator changes.
- **`neverEnded`** (in `cancelled` only): no module end in the log. It is the 011-137 survey's "never ended", and the check below needs it.

## 2. Sources

- Copies of this host's two stores, taken 2026-10-24 06:09:15Z (squeal, with `-wal` and `-shm`) and 06:09:18Z (cezar, which had no `-wal` file), each with its run logs copied directly after it, into the worker's scratch directory. Read only there. The live files were not opened.
- An eval run was active, so the copies were taken with `nice -n 10` and `ionice -c3`.
- The check scripts are in the worker's scratch directory, not in the repository: `cancelled.mjs`, `per-run.mjs`, `never-stored.mjs`. Each reads a copy and writes nothing.

## 3. Checks

### Check 1: the ten step-down runs of 22 and 23 October

The 011-137 survey (`tasks/011-137/notes.md`, on the 0.1.287 candidate) counted ten runs whose report fails with `run cancelled: the daemon stepped down for newer hooks`: 1,315 files picked, 580 never ended, of which the log named 9 by a `PASS` or `FAIL` line, so at most 571 never started. All ten are still in today's squeal copy. Over the window that holds them (`waste.mjs <copy> 21.5 <runs> 2026-10-23T04:03:00Z`), `cancelled` gives:

```json
"run cancelled: the daemon stepped down for newer hooks": {
  "runs": 10, "withoutLog": 0, "picked": 1315, "neverEnded": 580, "neverStarted": 569, "handedOver": 328 }
```

A separate script (`per-run.mjs`) reads the same logs with string matches in place of the line parser, run by run:

| Run | Worktree | Picked | Never ended | of them named by a test line | by a console line | Never started | Handed over | Later runs of the worktree in the copy |
|---|---|---|---|---|---|---|---|---|
| d53b00b1 | 998aca77 | 200 | 114 | 3 | 0 | 111 | 61 | 2 |
| a02b1e9c | 998aca77 | 200 | 104 | 0 | 0 | 104 | 104 | 1 |
| 2f1df763 | f6b7b547 | 200 | 70 | 0 | 0 | 70 | 0 | 0 |
| 7485cc3e | e34fc3f1 | 200 | 123 | 0 | 0 | 123 | 123 | 6 |
| 18620313 | e34fc3f1 | 200 | 8 | 3 | 0 | 5 | 5 | 5 |
| c8504266 | e34fc3f1 | 46 | 22 | 1 | 0 | 21 | 21 | 4 |
| 175abadf | e34fc3f1 | 34 | 13 | 0 | 1 | 12 | 12 | 3 |
| 352de9d1 | e34fc3f1 | 23 | 4 | 2 | 0 | 2 | 2 | 2 |
| e3a84aca | e34fc3f1 | 12 | 0 | 0 | 0 | 0 | 0 | 1 |
| 2f73cc36 | 6d45a893 | 200 | 122 | 1 | 0 | 121 | 0 | 0 |
| all | | 1,315 | 580 | 10 | 1 | 569 | 328 | |

*read from the store copy and its run logs.*

The two counts agree, and each run's "never ended" is the survey's. The log names 11 of the 580, not the survey's 9: one test line is a `SKIP` line, which the survey did not count (it read that the run log prints no skipped test; it does), and one file is named by a console line only. So 569 never started, inside the bound of 571.

328 of the 569 were handed over. Of the other 241, 191 are in `2f1df763` and `2f73cc36`: their worktrees were removed and have no later run in the copy, so their successors' runs, if any ran, were pruned with them (the README's second limit). The other 50 are in `d53b00b1`: its worktree's two later runs did not pick them (the survey's finding 2; why is not determined).

### Check 2: today's 24 hours

`waste.mjs <copy> 24 <runs> 2026-10-24T06:09:15Z`, the daily's command with the copy's time as its end. Squeal: 1,380 runs, all with a report. Cezar: 2,405 runs, 474 with no report.

| Project | Picked | `keptShare` (C3) | `neverStarted` | `handedOver` | `keptShareStarted` |
|---|---|---|---|---|---|
| squeal, `all` | 24,564 | 88.4% | 2,016 | 1,489 | 94.1% |
| squeal, `live` | 7,773 | 85.1% | 860 | 859 | 95.7% |
| squeal, `removed` | 16,791 | 89.9% | 1,156 | 630 | 93.4% |
| cezar, `all` | 18,986 | 87.9% | 1,221 | 1,143 | 93.5% |
| cezar, `live` | 15,262 | 86.7% | 1,081 | 1,008 | 92.9% |
| cezar, `removed` | 3,724 | 92.7% | 140 | 135 | 96.2% |

Per cancel cause (`cancelled`):

| Project | Cause (after `run cancelled: `) | Runs | Picked | Never ended | Never started | Handed over |
|---|---|---|---|---|---|---|
| squeal | an edit arrived during a backlog tier | 20 | 2,896 | 1,548 | 1,533 | 1,007 |
| squeal | the revisions during it changed an input of every file that had not ended | 41 | 756 | 350 | 340 | 339 |
| squeal | it yielded to an edit's work, a promoted file or a runner part waiting for it | 31 | 317 | 148 | 143 | 143 |
| cezar | an edit arrived during a backlog tier | 18 | 1,423 | 695 | 695 | 655 |
| cezar | it yielded to an edit's work, … | 81 | 678 | 351 | 324 | 324 |
| cezar | the revisions during it changed an input of every file that had not ended | 58 | 426 | 163 | 143 | 112 |
| cezar | squeal stop | 5 | 108 | 22 | 21 | 14 |
| cezar | squeal hold | 10 | 68 | 44 | 38 | 38 |
| cezar | the daemon stepped down for newer hooks | 2 | 11 | 9 | 0 | 0 |

*read from the store copies and their run logs.*

The causes sum to each project's `all.files.neverStarted` and `handedOver`. Today no step-down cancelled a squeal run in the window. Most never-started files come from backlog tiers that an edit cancelled: 1,533 of squeal's 2,016. In live worktrees almost every never-started file was picked again later (squeal 859 of 860, cezar 1,008 of 1,081); why cezar's other 73 were not is not determined.

### Check 3: the existing fields are unchanged

The script before this row (`git show a3d70c723:…/waste.mjs`) and after it ran on the same copies and windows: squeal 24 h, cezar 24 h, and squeal 21.5 h to 2026-10-23T04:03Z. With the four new keys removed, the two outputs are the same JSON string each time.

### Check 4: a never-started file holds no result

`never-stored.mjs` reads every cancelled run in each copy, at any time, and counts a file as never started by looser string matches. Squeal: 135 runs, 4,489 never-started files. Cezar: 181 runs, 1,234. None of them has a result under its run's id, and none is in its report's `completedFiles`. So subtracting `handedOver` from the denominator alone is right.

## 4. Decisions the brief did not settle

- **A console line names a file too.** The brief says "no module end, no test line". A console line tied to a file also shows that the file started, so it counts as named. It moved 1 of the ten runs' 580 files. A `SKIP` line counts as a test line.
- **`handedOver` reads the whole copy.** A later run counts when it started after the cancelled run, also when it started after the window's end. A run cancelled just before the copy has no later run yet, and its files count as not handed over. So `handedOver` and `keptShareStarted` are lower bounds.
- **A `cancelled` table.** The done-when asks the script to give the ten runs' never-ended split, and the per-scope fields cannot isolate one cause. So `cancelled` gives the counts per cause, with `neverEnded`.
- **No new fields in `recordedSeconds`.** A never-started file records no duration, and C3 is in files.
- **`checkpoint` gets the fields too.** It is built by the same `table` function.

## 5. Limits

- A file whose worker was still importing it at the cancel prints nothing, so it counts as never started although it cost some run time. That is at most one file per worker per run (inferred: no line of the reporter is written before a module's first test ends).
- A cancelled run with no `vitest.log` (node:test, pytest) counts no file as never started. In today's copies there are none.
- `handedOver` in `removed` misses the successors that the prune deleted (check 1, 191 files).

## 6. For whoever continues

- The daily run at 07:00Z reads `waste.mjs` from main. Once this row lands, its JSON holds the new fields in each `files` object and the `cancelled` table. The README tells the daily session to report `all.files.neverStarted`, `handedOver` and `keptShareStarted` with no target.
- C3's target and its row were not touched. Whether C3 should read `keptShareStarted` is the human's decision (the 011-114 criteria).
