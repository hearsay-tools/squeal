# 011-177: `waste.mjs` counts a module the cancel cut in its grace as cut

Worker 915a84f4, wave 32 W11 (`tasks/wave-32.md`), from main at 2a084c0fa, 2026-10-24. Shape: repair (probe). No product change.

## Answers

1. **`cancelled` now gives per cause `cut` and `cutSeconds`.** `cut` is a file the run picked that its `vitest.log` names, that the report did not complete, and whose `MODULE` line does not come before the log's note `squeal: run cancelled: …`. `cutSeconds` is their seconds as `tasks/011-136/probes/cut.mjs` counts its high bound.
2. **On fresh copies it matches `cut.mjs`.** For the cause "an edit arrived during a backlog tier", 24 hours to 2026-10-24T13:28:55Z: squeal `cut` 102 and `cut.mjs` 102 (87 grace, 15 in flight); cezar 43 and 43 (41, 2). `cutSeconds` 916 and 1,074 against `cut.mjs`'s 915.5 and 1,073.6 s (rounded to whole seconds, as the other seconds in `waste.mjs`).
3. **`neverEnded` is `cut` plus `neverStarted`** for every cause in both projects (9 causes).
4. **C3 does not move.** `all.files.keptShareStarted` is 98.3% (squeal) and 97.2% (cezar) with today's script and with the new one. Every field outside `cancelled` is identical between the two outputs.

## 1. Sources and load

- Copies of the two stores, each with its `-wal` and `-shm`, then its run logs, back to back, under `nice -n 10 ionice -c3`: squeal's copy ended at 13:29:01Z, cezar's at 13:29:04Z (`/home/agent/projects/{squeal,cezar}/.git/squeal/`). Read only, in the worker's scratch folder. No live store or socket was opened; no test, eval or `evals/bin/` script ran; no build ran.
- Load (`/proc/loadavg`, 24 CPUs): 7.16, 8.26, 20.22 before the copies and 7.16 after them; 7.00 to 6.48 while today's `waste.mjs` and `cut.mjs` ran (13:29:14Z to 13:29:25Z); 6.50 to 6.70 while the new `waste.mjs` ran (13:30:38Z to 13:30:41Z).
- Each script ran under `nice -n 10 ionice -c3`. Wall and peak memory: today's `waste.mjs` 3.2 s and 5.8 s, 177 and 200 MB; `cut.mjs` 0.8 s and 1.3 s, 178 and 200 MB; the new `waste.mjs` 1.0 s and 2.0 s, 195 and 217 MB (squeal, cezar; the first runs read the logs cold, *inferred*).
- Outputs in `results/`: `waste-before-*.json` (the script at main 2a084c0fa), `waste-*.json` (this row's), `cut-*.jsonl` (`cut.mjs`, unchanged). Same window for all three: `24` hours, end `2026-10-24T13:28:55Z`.

## 2. The cause "an edit arrived during a backlog tier"

| 24 h to 13:28:55Z | squeal | cezar |
|---|---|---|
| Runs | 21 | 18 |
| Files picked | 2,774 | 1,323 |
| `cut.mjs`: ended in the grace | 87 | 41 |
| `cut.mjs`: never ended (in flight) | 15 | 2 |
| **`cut.mjs`: started and cut** | **102** | **43** |
| **`waste.mjs` `cut`** | **102** | **43** |
| `cut.mjs`: seconds, high bound (grace plus in flight) | 915.5 | 1,073.6 |
| `waste.mjs` `cutSeconds` | 916 | 1,074 |
| `neverStarted` (both) | 1,299 | 659 |
| `neverEnded`, today's script | 1,314 | 661 |
| `neverEnded`, this row | 1,401 | 702 |
| `neverEnded` minus `neverStarted`, today's script | 15 | 2 |

*Read from the store copies and their run logs.* Today's script reads only the in-flight files as not ended (15 and 2), as 011-136 F1 found (15 and 0 on its window).

## 3. Every cause

| Project, cause | Runs | Picked | `neverEnded` before | `neverEnded` now | `cut` | `cutSeconds` | `neverStarted` |
|---|---|---|---|---|---|---|---|
| squeal, an edit arrived during a backlog tier | 21 | 2,774 | 1,314 | 1,401 | 102 | 916 | 1,299 |
| squeal, the revisions during it changed an input of every file that had not ended | 39 | 556 | 79 | 134 | 66 | 699 | 68 |
| squeal, it yielded to an edit's work, a promoted file or a runner part waiting for it | 31 | 316 | 144 | 198 | 60 | 2,296 | 138 |
| cezar, it yielded to an edit's work, a promoted file or a runner part waiting for it | 55 | 610 | 312 | 400 | 106 | 8,348 | 294 |
| cezar, an edit arrived during a backlog tier | 18 | 1,323 | 661 | 702 | 43 | 1,074 | 659 |
| cezar, the daemon stepped down for newer hooks | 5 | 18 | 11 | 12 | 12 | 1,002 | 0 |
| cezar, the revisions during it changed an input of every file that had not ended | 22 | 277 | 133 | 161 | 33 | 2,649 | 128 |
| cezar, squeal stop | 5 | 117 | 21 | 43 | 23 | 2,011 | 20 |
| cezar, squeal hold | 10 | 69 | 45 | 64 | 27 | 1,344 | 37 |

`withoutLog` is 0 for every cause. `cut.mjs` reads only the backlog cause, so the other rows have no reference count.

## 4. Decisions the brief did not settle

- **A completed file counts as ended.** `namedIn` gives `ended` only the `MODULE` lines before the note, as the brief says. `neverEnded` also leaves out a file in the report's `completedFiles`. Without that, a step-down's whole module that 011-137 completes from the grace would be in `neverEnded` and not in `cut`, and `neverEnded` would not be `cut` plus `neverStarted`. On this window the two readings give the same counts for every cause (checked with a variant of the script that drops the clause).
- **`cutSeconds` is `cut.mjs`'s high bound:** the file's module duration in the nearest later run of its worktree (any run in the copy) that reports one, at most the cancelled run's wall; the wall when none does. This is the reading 011-136 section 5 proposed for the README. `cut.mjs`'s low bound (the durations of the file's tests that passed or failed before the cancel) is not in `waste.mjs`.
- **A file with a `MODULE` line both before and after the note** reads as ended here and as ended in the grace in `cut.mjs`. No such file is in this window (the counts are equal).
- **The README's "Report these too" list is unchanged.** It names the figures the daily writes; the brief gives this row the text on `waste.mjs` only. A line the coordinator can add: "and from `cancelled`, per cause, `cut` and `cutSeconds`".

## 5. Limits

- One window of 24 hours. The step-down cause has 5 runs here, and none has a completed file without a `MODULE` line before the note, so the completed-file clause is not exercised by this data.
- `cutSeconds` is a high bound: a later run's module duration under another load, and the wall for a file no later run reports (1 file in each project for the backlog cause, `cut.mjs`'s `unknown`).
- The totals agree; the per-run counts were not compared, since `waste.mjs` prints no per-run lines.

## 6. For whoever continues

- `node --disable-warning=ExperimentalWarning research/probes/host-load/waste.mjs <store copy> 24 <runs copy> <end ISO>` gives the `cancelled` table with the new fields; `tasks/011-136/probes/cut.mjs` with the same arguments gives the reference for the backlog cause.
- The yield cause cut the most seconds on this window: cezar 106 files and 8,348 s, squeal 60 files and 2,296 s, high bounds. 011-136 measured only the backlog cause. A low bound for the yield cause would need `cut.mjs`'s `ranAtLeast` for that cause; not done here.
- The store copies of this row are in the worker's scratch folder (`t/915a84f4/copies`), kept until the row's review; they go with the worker's scratch.
