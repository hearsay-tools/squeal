# 011-180: what a tier's yield to an edit's work cuts and what it buys

Worker f24c37b0, wave 32 W12 (`tasks/wave-32.md`), from main at 8c9fffbfd, 2026-10-24. Shape: survey. No product change.

## Answers

1. **Started and cut, 24 hours to 2026-10-24T13:38Z.** Squeal: 31 yields cut 60 started files, 687 to 2,296 recorded seconds. Cezar: 55 yields cut 106, 7,529 to 8,348 s. That is 0.17% and 0.54% of the day's picked files (35,232 and 19,807), and 0.3% to 0.9% and 2.2% to 2.5% of the day's recorded seconds (255,705 s and 339,483 s). Low and high are `cut.mjs`'s two bounds (section 2).
2. **Every yield met rule B by the daemon's own estimate**, as the code allows no other path to the cause. The cancel times agree. By the probe's inferred estimate, 8 squeal yields came at an event with a remainder over 30 s and 19 at an overrun bound. 7 of these overruns came 30 to 32 s after the tier's start, which needs the daemon to hold no known duration, or one under about 1 s, for every file in flight. In cezar the counts are 29 and 22 (4 at 30 s). The other 4 in each project fit one of the two branches on a duration other than the probe's (section 3). **In fact, the tier would have ended within 30 s anyway in 8 of squeal's 30 measurable yields and 10 of cezar's 42.** Those yields threw away 364 s and 1,088 s (high bound) for at most 30 s each.
3. **What each yield waited for.** Squeal: an edit's work. 29 of 31 had a revision during the run, and 3 had a named wait in the worktree. Cezar: mostly named waits. 35 of 55 had a live `squeal status --wait` in the worktree when they fired, and 27 of them ran a named file next. 19 had a revision. **The work they yielded to started a median 0.2 s (squeal) and 0.7 s (cezar) after the cancelled run ended.** From the latest live wait to the start of the tier that held its file: median 6 s in cezar (27 yields, 1.0 to 46.5 s, one 259.5 s). From a revision during the run: 4.2 s in squeal (1) and 4.4 to 57.2 s in cezar (6, live worktrees only).
4. **What it bought: the next tier started a median of 71 s (squeal) and 73 s (cezar) sooner,** 3,960 s and 4,801 s in total. This is the cut files' remainder past the run's end, in tiers whose files all started.
5. **Letting the started modules end before the cancel, up to a bound, keeps little for its cost.** A 10 s bound keeps 12 and 24 cut files (387 s and 1,624 s, high). It adds 269 s and 354 s to the waiting work, about 9 s per yield. Half of squeal's kept files and 15 of cezar's 24 are uncertain: their later run was faster than this run's wall. Waiting only for the files the daemon's estimate says end within 30 s keeps 7 and 3 files (199 s and 58 s): the estimates miss the files that end soon. 011-137's keep of a whole module that ended in the grace keeps none (section 4).
6. **One change:** once a tier has run 30 s, a promoted file makes it yield only when it ranks before every file of the tier that has not ended. So the tier does not cut a file that the same or an earlier open wait selected. That wait returns only when each file it selects is current (005 D2), so the cut can only delay it, by up to the time the file had run. On this day the rule refuses 11 cezar yields (1 unsure) and keeps 23 files, 2,452 to 2,775 s, a third of cezar's yield cost. Squeal is unchanged. The promoted files then wait for the tier's remainder: a median of 159 s, 2,115 s in all. **Recommendation: put it to the human** (section 6). Rule B is the human's, so this row proposes only.

## 1. Sources and load

- Copies of this host's two stores, each with its `-wal` and `-shm`, then its run logs, back to back, under `nice -n 10 ionice -c3`. Squeal's copy: 13:38:27Z to 13:38:28Z. Cezar's copy: 13:38:28Z to 13:38:32Z. Load (`/proc/loadavg`, 24 CPUs): 22.25 before squeal's copy and 22.23 after cezar's (`probes/results/load.txt`). Read only, in the worker's scratch folder (`t/f24c37b0/copies`). No live store or socket was opened. No test, eval, build or `evals/bin/` script ran.
- `research/probes/host-load/waste.mjs` from main at 8c9fffbfd on both copies, 24 hours to 2026-10-24T13:38:00Z (`probes/results/waste-*.json`). Its yield cause gives the same counts as 011-177's window: squeal 31 runs, `cut` 60, `cutSeconds` 2,296; cezar 55, 106, 8,348.
- Probes in this folder, each read only on a copy or on another probe's output:
  - `probes/yield.mjs`: `tasks/011-136/probes/cut.mjs` with the cause changed to the yield. It keeps the same file classes and the same two bounds. It adds the daemon's estimate at the cancel and rule B's branch, the revisions during the run, the next run of the worktree in the fast Vitest lane, each cut file's remainder, and 011-137's whole and uncut readings. Its `cut` and high bound equal `waste.mjs`'s.
  - `probes/waits.mjs`: every `squeal status --wait` call in this host's Codex and Claude Code transcripts in the window, with the folder it ran in. Read only. The notes quote file paths and times only.
  - `probes/match.mjs`: for each yield, the waits of its worktree issued at most 62 s before the run's end, and the files they selected.
  - `probes/sum.mjs`, `probes/table.mjs`, `probes/proposal.mjs`: the sums, the per-yield tables and the proposed rule, from the outputs above.
  - Outputs in `probes/results/`. Loads at each run are in `load.txt`. Peak memory was 512 MB and the longest wall was 2.1 s.
- Source read: `src/core/scheduler/{yields,backlog,tiers,queue,promotions,bootstrap,ledger,files,install,revision}.ts`, `src/runners/vitest/{run,reporter}.ts`, `src/core/store/{schema,repos/results}.ts`, `src/core/fs/git-layout.ts`, both projects' `squeal.config.json` (both `lookup-only`, `runner.tierSize` 4), spec 011 C4 step 5 and C15, 005 D2.

Evidence tags as in `docs/process.md`: *read from the store copy*, *read from run logs*, *read from transcripts*, *read in source code*, *inferred*, *modelled*.

## 2. What the yields cut

| 24 h to 13:38Z | squeal | cezar |
|---|---|---|
| Yields (runs with the cause "it yielded to an edit's work, a promoted file or a runner part waiting for it") | 31 | 55 |
| Edit-sized tiers (at most 4 files, `runner.tierSize`): yields, cut files, cut s | 30 (21 with a checkpoint's files), 52, 678 to 2,262 | 46, 79, 6,731 to 7,468 |
| Backlog-sized tiers (more than 4 files): yields, cut files, cut s | 1 (200 files), 8, 8.5 to 34 | 9 (6 to 200 files), 27, 798 to 881 |
| Files picked | 316 | 610 |
| Ended before the cancel (the report's `completedFiles`) | 118 | 210 |
| **Started and cut: ended in the grace** | **54** | **88** |
| of them whole by 011-137's rule, or uncut (no skipped test) | 0, 0 | 0, 4 (182 s) |
| **Started and cut: in flight at the end** | **6** | **18** |
| Never started (all handed over to a later run) | 138 | 294 |
| **Recorded seconds of the started-and-cut files, low to high** | **687 to 2,296** | **7,529 to 8,348** |
| Of them ran again in a later run of the worktree | 60 | 105 |

*Read from the store copies and their run logs* (`probes/yield.mjs`, `results/yield-*.jsonl`). Low is the durations of the file's tests that the log reports passed or failed in the run. High is the file's module duration in the next run of its worktree that reports one, at most the cancelled run's wall. The tier's kind is not stored. A tier of more than `runner.tierSize` files is the backlog's. A tier of at most 4 files is taken as an edit's: the backlog's turn yields to nothing and a focused tier leads its lane, so neither appears here (*read in source code*, `yields.ts` `#decide`).

- **F1. A few long files carry the seconds.** In cezar, 21 files were cut 2 to 6 times each, across worktrees and keys. The six largest are `waits-claude-workers-parity.test.ts` (6 cuts, 1,323 s high), `waits-claude-parity.test.ts` (4, 724 s), `workflow-autonomous-parity.test.ts` (4, 532 s), `run.test.ts` (4, 512 s), `waits-cursor-parity.test.ts` (3, 502 s) and `skill-resume-parity.test.ts` (6, 366 s). In squeal, 2 files were cut twice. *Read from the store copy* (`results/sum-*.json`, `repeated`).
- **F2. A load failure gave a stale short estimate, and the overrun rule then cut the file at 30 s, three times.** In cezar worktree 8d98b80f, `skill-resume-parity.test.ts` failed to load in 465855ed at revision 9 (`MODULE failed`, no test run). That run stored a file-level failure of 57 ms and 41 test failures of 0 ms, so the file's last-known duration became 0.06 s (`durationOf`). The tiers that then held it at r11 and r19 ran it for real and yielded 31 s in (2e7ae991, 9077a52a, ec8e900c): the overrun bound on that estimate. It ran whole only alone, in a7eadbee at r20 (313 s). The two cuts at r19 came 4 minutes apart at the same key. The one-cut mark is the daemon's memory, and 8d98b80f's fast lane ran nothing for the 3.4 minutes between them, then started two lanes at once. A restart in between is *inferred*. Worktree a6e709c7 cut the same file twice more (9c8c963d, c27dc6ca). Those cuts fit a remainder yield on an older estimate of about 100 s (*inferred*). *Read from the store copy and run logs.*
- **F3. Squeal's yields sit in one worktree.** 27 of 31 are in 2ccf922d (removed), 19:45Z to 00:36Z: 125 revisions (r6 to r131) in under 5 hours, while edit-sized tiers of up to 4 files ran. 21 of these tiers held a `run --all` checkpoint's files. Many cut files ran far longer there than elsewhere. `rerun-failure.test.ts` took 481 s in its next run in 2ccf922d, against 4 to 23 s in the store's results of other worktrees. For most cut files the store held 2.5 to 48 s from other worktrees (R2). *Read from the store copy and run logs.*

## 3. Rule B and the wait, per yield

"Rule B (probe)": the probe's estimate is the file's module duration in the nearest earlier run of the same worktree, else of any worktree. It approximates the daemon's last-known duration, so it is *inferred*. *remainder*: that estimate's largest value among the files not ended before the note, less the wall, is over 30 s. *overrun*: the wall exceeds it by 30 s or more. *overrun at 30 s*: an overrun that came 30 to 32 s after the start, which needs an estimate of at most about 1 s for every file in flight: none known, or cezar's 57 ms of F2. *neither*: the probe's estimate fits no branch.

"Waited for": *a revision* is exact in a live worktree (`rN`). In a removed worktree it means the next tier ran at a higher revision. *a wait* is a `squeal status --wait` of the worktree issued at most 62 s before the run's end (`probes/match.mjs`). It says whether that wait named a file this yield cut, or the next tier's file. "Event before the end": the latest such wait, else the first revision during the run, in seconds before the run's end (blank when not known). "Cut files' remainder past the end": the longest cut file's later duration less the wall, in tiers whose files all started at once (at most 23 files, none never started). It is how much sooner the next tier started. "Next tier after the end": the next run of the worktree in the fast Vitest lane.

### squeal

| Run | Worktree | Files | Start (UTC) | Wall, s | Rule B (probe) | Waited for | Event before the end, s | Cut: grace + in flight | Cut s, low to high | Cut files' remainder past the end, s | Next tier after the end, s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| e7795e47 | 2ccf922d (removed) | 4 | 10-23 19:45:45 | 30.1 | overrun at 30 s | a revision |  | 2 + 0 | 0.0 to 60.3 | 450.7 | 0.1 |
| 92334039 | 2ccf922d (removed) | 4 | 10-23 19:47:31 | 30.3 | overrun at 30 s | a revision; a wait, named file next | 20.8 | 2 + 0 | 0.0 to 60.6 | 453.7 | 0.1 |
| 899f7fff | 2ccf922d (removed) | 4, checkpoint | 10-23 20:40:17 | 30.4 | overrun at 30 s | a revision |  | 3 + 0 | 0.0 to 91.1 | 65.0 | 0.2 |
| c8a62cda | 2ccf922d (removed) | 4, checkpoint | 10-23 20:53:36 | 87.5 | overrun | a revision |  | 1 + 0 | 0.0 to 87.5 | 38.5 | 0.6 |
| a5b01634 | 2ccf922d (removed) | 4, checkpoint | 10-23 20:57:24 | 49.5 | neither | a revision |  | 2 + 0 | 0.0 to 98.9 | 108.9 | 0.1 |
| adad138e | 2ccf922d (removed) | 4, checkpoint | 10-23 21:04:21 | 72.1 | overrun | a revision |  | 3 + 0 | 62.4 to 216.2 | 71.0 | 0.2 |
| b923b132 | 2ccf922d (removed) | 4, checkpoint | 10-23 21:06:29 | 31.7 | overrun at 30 s | a revision |  | 3 + 0 | 0.0 to 95.0 | 96.3 | 0.2 |
| f2719729 | 2ccf922d (removed) | 4, checkpoint | 10-23 21:07:14 | 30.4 | overrun at 30 s | a revision |  | 2 + 0 | 0.0 to 34.3 | 96.6 | 0.1 |
| 0df5bb49 | 2ccf922d (removed) | 4, checkpoint | 10-23 21:07:47 | 56.5 | overrun | a revision |  | 1 + 0 | 0.0 to 56.5 | 65.8 | 0.2 |
| e122f94b | 31299079 (removed) | 4 | 10-23 21:12:11 | 94.1 | remainder | a revision |  | 1 + 1 | 130.8 to 188.2 | 33.3 | 0.1 |
| 05d540ce | 2ccf922d (removed) | 4, checkpoint | 10-23 21:18:33 | 58.0 | overrun | a revision |  | 2 + 0 | 64.3 to 116.1 | 71.8 | 0.5 |
| 1e6a7cee | 2ccf922d (removed) | 4, checkpoint | 10-23 21:24:04 | 60.4 | neither | a revision |  | 1 + 0 | 41.2 to 60.4 | 6.0 | 0.4 |
| 85c61461 | 2ccf922d (removed) | 4, checkpoint | 10-23 21:25:41 | 30.5 | overrun at 30 s | a revision |  | 1 + 0 | 7.8 to 30.5 | 21.2 | 0.2 |
| 1236de6c | 2ccf922d (removed) | 4, checkpoint | 10-23 21:30:22 | 44.7 | overrun | a revision |  | 1 + 0 | 30.3 to 44.7 | 77.2 | 0.4 |
| eeaec8dc | 2ccf922d (removed) | 4, checkpoint | 10-23 21:46:29 | 51.3 | overrun | a revision |  | 1 + 0 | 0.0 to 51.3 | 379.7 | 0.6 |
| 394f2fcd | 2ccf922d (removed) | 4, checkpoint | 10-23 21:52:15 | 69.5 | overrun | a revision |  | 1 + 0 | 61.1 to 69.5 | 113.0 | 1.0 |
| cc790c62 | 2ccf922d (removed) | 4, checkpoint | 10-23 21:53:33 | 30.2 | overrun at 30 s | a revision |  | 3 + 0 | 1.9 to 90.5 | 457.4 | 0.2 |
| a55ec396 | 2ccf922d (removed) | 4, checkpoint | 10-23 21:54:14 | 31.2 | remainder | a revision |  | 1 + 1 | 3.8 to 62.4 | 38.2 | 0.2 |
| 57a95af3 | 2ccf922d (removed) | 4, checkpoint | 10-23 21:55:22 | 60.8 | neither | a revision |  | 1 + 0 | 30.8 to 60.8 | 2.9 | 0.8 |
| b9c2959f | 2ccf922d (removed) | 3 | 10-23 21:56:35 | 8.7 | remainder | a revision |  | 2 + 0 | 7.6 to 17.4 | 27.7 | 0.2 |
| 41d3e539 | 2ccf922d (removed) | 4, checkpoint | 10-23 22:03:55 | 70.3 | overrun | a revision |  | 1 + 0 | 0.0 to 70.3 | 410.6 | 0.3 |
| 25cda995 | 2ccf922d (removed) | 4, checkpoint | 10-23 22:05:05 | 32.5 | overrun | a revision |  | 1 + 0 | 11.9 to 29.4 | -3.1 | 0.2 |
| 70f636de | 2ccf922d (removed) | 4, checkpoint | 10-23 22:14:34 | 56.2 | overrun | a revision |  | 1 + 0 | 0.0 to 56.2 | 249.9 | 0.3 |
| 527a6fd3 | 2ccf922d (removed) | 4, checkpoint | 10-23 22:26:18 | 94.6 | overrun | a revision |  | 1 + 0 | 0.0 to 94.6 | 278.4 | 0.3 |
| a3697bab | 2ccf922d (removed) | 4, checkpoint | 10-23 22:43:21 | 78.3 | remainder | a revision |  | 1 + 1 | 71.0 to 156.6 | 165.9 | 0.3 |
| 9c3cd9b3 | 2ccf922d (removed) | 3 | 10-23 23:28:59 | 11.8 | remainder | a wait that named 2 cut files | 3.1 | 2 + 0 | 6.7 to 23.6 | 23.0 | 0.3 |
| 49d12173 | 2ccf922d (removed) | 200 | 10-24 00:08:30 | 40.5 | overrun | a wait | 30.1 | 7 + 1 | 8.5 to 34.4 | not all started | 0.2 |
| 2a90b7c1 | 2ccf922d (removed) | 4 | 10-24 00:36:16 | 28.5 | remainder | a revision |  | 3 + 0 | 14.8 to 58.1 | 41.0 | 71.2 |
| 732f952d | 6928333e (removed) | 4 | 10-24 02:49:09 | 33.4 | neither | a revision |  | 0 + 1 | 1.8 to 32.1 | -1.3 | 0.1 |
| 14dcf952 | 4de73861 (removed) | 3 | 10-24 11:51:45 | 39.0 | remainder | a revision |  | 0 + 1 | 29.9 to 39.0 | 100.0 | 347.6 |
| 1ae7ec7f | c60b812f (live) | 3 | 10-24 12:39:00 | 37.2 | remainder | r11 | 4.1 | 3 + 0 | 100.2 to 109.9 | 16.4 | 0.1 |

### cezar

| Run | Worktree | Files | Start (UTC) | Wall, s | Rule B (probe) | Waited for | Event before the end, s | Cut: grace + in flight | Cut s, low to high | Cut files' remainder past the end, s | Next tier after the end, s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1e09718a | 20d1db55 (removed) | 37 | 10-23 13:42:32 | 36.6 | neither | a wait, named file next | 36.9 | 1 + 0 | 0.0 to 7.3 | not all started | 0.9 |
| 3ead9f2d | a6e709c7 (removed) | 4 | 10-23 16:13:42 | 49.7 | remainder | a revision |  | 1 + 1 | 73.6 to 98.6 | 41.6 | 0.7 |
| 79f7a847 | a6e709c7 (removed) | 4 | 10-23 16:24:35 | 134.6 | remainder | a wait, named file next | 1.4 | 1 + 0 | 132.5 to 134.6 | 59.1 | 0.3 |
| 465855ed | 8d98b80f (removed) | 4 | 10-23 16:44:57 | 30.9 | remainder | a revision; a wait | 57.2 | 3 + 0 | 56.4 to 92.6 | 80.1 | 6.0 |
| 2e7ae991 | 8d98b80f (removed) | 4 | 10-23 16:47:23 | 31.3 | overrun at 30 s | a revision |  | 1 + 0 | 0.0 to 31.3 | 281.5 | 265.4 |
| 9c8c963d | a6e709c7 (removed) | 4 | 10-23 16:53:08 | 31.4 | overrun at 30 s | a revision; a wait | 17.4 | 1 + 0 | 16.8 to 31.4 | 128.2 | 8.5 |
| 9077a52a | 8d98b80f (removed) | 4 | 10-23 16:53:32 | 31.1 | overrun at 30 s | a wait that named 1 cut file | 58.1 | 1 + 0 | 0.0 to 31.1 | 281.6 | 201.4 |
| c27dc6ca | a6e709c7 (removed) | 4 | 10-23 16:57:21 | 72.5 | overrun | a wait, named file next | 3.0 | 1 + 0 | 66.3 to 72.5 | 87.1 | 0.6 |
| ec8e900c | 8d98b80f (removed) | 4 | 10-23 16:57:25 | 31.0 | overrun at 30 s | a revision; a wait that named 1 cut file | 40.9 | 1 + 0 | 0.0 to 31.0 | 281.7 | 0.6 |
| 0196b2db | a6e709c7 (removed) | 4 | 10-23 16:58:34 | 143.8 | remainder | a wait that named 2 cut files | 2.0 | 2 + 0 | 269.2 to 287.6 | 396.4 | 0.7 |
| d2054886 | d15de12f (removed) | 4 | 10-23 17:08:45 | 36.9 | neither | a wait, named file next | 5.2 | 1 + 0 | 21.3 to 32.5 | -4.5 | 3.5 |
| 8bf747ac | 8d98b80f (removed) | 4 | 10-23 17:09:14 | 58.9 | remainder | a revision |  | 1 + 0 | 53.0 to 58.8 | -0.1 | 0.6 |
| d08d705d | 564fa151 (removed) | 4 | 10-23 17:10:14 | 98.9 | overrun | a revision; a wait | 11.8 | 1 + 0 | 76.4 to 98.9 | no later run | 1579.4 |
| 06c55d2f | 5e76f9b0 (removed) | 4 | 10-23 17:46:25 | 351.0 | remainder | a wait that named 1 cut file | 5.9 | 0 + 1 | 332.4 to 351.0 | 62.9 | 0.9 |
| 0de48a6a | 700e10dd (removed) | 4 | 10-23 17:46:25 | 81.3 | remainder | a wait, named file next | 45.7 | 1 + 2 | 204.9 to 243.9 | 96.0 | 0.8 |
| 0f9db7cc | 5e76f9b0 (removed) | 4 | 10-23 17:52:16 | 261.6 | remainder | a wait that named 2 cut files | 5.0 | 1 + 1 | 500.7 to 523.1 | 159.2 | 0.7 |
| 9a9f3b34 | d15de12f (removed) | 4 | 10-23 18:10:28 | 309.5 | remainder | a wait, named file next | 34.2 | 1 + 0 | 306.0 to 309.5 | 66.5 | 0.9 |
| 4be9a483 | 8d98b80f (removed) | 4 | 10-23 18:23:50 | 28.3 | remainder | a revision; a wait | -0.2 | 2 + 1 | 61.3 to 84.9 | 48.4 | 3.0 |
| 7ef80fd1 | a6e709c7 (removed) | 4 | 10-23 18:36:08 | 20.3 | remainder | a revision; a wait that named 2 cut files | 7.6 | 2 + 0 | 29.5 to 40.6 | 8.8 | 0.4 |
| 4f874ee9 | 8d98b80f (removed) | 4 | 10-23 18:38:54 | 199.3 | neither | no revision, no wait found |  | 1 + 0 | 197.4 to 199.3 | 43.9 | 0.6 |
| 9074c84b | 8d98b80f (removed) | 4 | 10-23 18:42:51 | 168.4 | remainder | no revision, no wait found |  | 3 + 0 | 494.5 to 505.3 | 89.8 | 0.4 |
| ccbb872d | bcf1abf6 (live) | 4 | 10-23 18:44:13 | 185.4 | remainder | a wait, named file next | 2.9 | 2 + 0 | 356.9 to 370.9 | 40.6 | 0.4 |
| dd2b498a | 8d98b80f (removed) | 4 | 10-23 18:46:46 | 285.9 | remainder | no revision, no wait found |  | 1 + 0 | 281.2 to 285.9 | 222.8 | 0.7 |
| 155bf309 | bcf1abf6 (live) | 1 | 10-23 18:54:13 | 9.1 | remainder | r21; a wait, named file next | 17.6 | 0 + 0 | 0.0 to 0.0 | none cut | 0.2 |
| fa2ca271 | bcf1abf6 (live) | 4 | 10-23 18:57:33 | 2.5 | remainder | a wait that named 1 cut file | 19.3 | 3 + 0 | 0.0 to 7.4 | not all started | 0.2 |
| 8c5addea | bcf1abf6 (live) | 1 | 10-23 19:05:47 | 9.8 | remainder | a wait that named 1 cut file | 3.3 | 1 + 0 | 7.4 to 9.8 | 176.1 | 0.4 |
| 4688bfd5 | bcf1abf6 (live) | 2 | 10-23 19:14:04 | 27.0 | remainder | a wait that named 1 cut file | 4.7 | 2 + 0 | 43.3 to 53.9 | 210.0 | 0.2 |
| 77d77da1 | 8d98b80f (removed) | 4 | 10-23 19:16:20 | 153.5 | remainder | no revision, no wait found |  | 0 + 1 | 146.3 to 153.5 | 117.5 | 0.5 |
| adde770c | 8d98b80f (removed) | 4 | 10-23 19:25:27 | 120.0 | remainder | a revision |  | 1 + 0 | 117.1 to 120.0 | 33.1 | 4.3 |
| 8df3c6fc | 8d98b80f (removed) | 4 | 10-23 19:27:36 | 12.5 | remainder | a wait that named 2 cut files | 2.0 | 3 + 0 | 31.0 to 37.4 | 30.7 | 34.0 |
| b3a5fed9 | 8d98b80f (removed) | 200 | 10-23 20:00:16 | 33.7 | overrun | a revision; a wait | 38.6 | 2 + 0 | 0.0 to 1.9 | not all started | 47.2 |
| 19ffa47b | a6e709c7 (removed) | 4 | 10-23 20:01:55 | 92.4 | remainder | a revision |  | 2 + 0 | 168.5 to 156.7 | 60.2 | 4.5 |
| 108b2064 | 8d98b80f (removed) | 23 | 10-23 20:12:41 | 54.0 | overrun | no revision, no wait found |  | 3 + 0 | 13.1 to 44.0 | not all started | 0.4 |
| a3eb96f0 | bcf1abf6 (live) | 4 | 10-23 21:22:05 | 92.2 | remainder | a wait that named 1 cut file | 4.1 | 3 + 0 | 257.1 to 254.9 | 220.2 | 0.4 |
| 55e9db01 | 8d98b80f (removed) | 9 | 10-23 21:33:42 | 64.6 | overrun | a wait | 54.6 | 3 + 0 | 88.9 to 84.8 | not all started | 0.5 |
| 372745be | 8d98b80f (removed) | 3 | 10-23 21:48:04 | 93.8 | overrun | no revision, no wait found |  | 1 + 0 | 35.8 to 59.3 | -34.5 | 0.6 |
| 7781e596 | 3a40e85f (removed) | 139 | 10-23 22:24:25 | 71.2 | overrun | no revision, no wait found |  | 3 + 0 | 5.2 to 11.1 | not all started | 1.6 |
| 7ee84410 | 8d98b80f (removed) | 2 | 10-23 22:26:50 | 320.4 | overrun | a wait | 2.4 | 0 + 1 | 311.9 to 320.4 | 33.5 | 0.9 |
| 0da0178f | bcf1abf6 (live) | 4 | 10-23 22:39:18 | 56.7 | remainder | a wait that named 1 cut file | 2.1 | 2 + 1 | 151.9 to 170.1 | 96.2 | 0.7 |
| b778f4e4 | 3a40e85f (removed) | 6 | 10-23 22:51:36 | 61.9 | overrun | no revision, no wait found |  | 2 + 0 | 22.2 to 72.1 | not all started | 0.7 |
| 78b13ae2 | 3a40e85f (removed) | 6 | 10-23 22:56:27 | 93.6 | overrun | a revision |  | 5 + 0 | 351.0 to 353.3 | 9.2 | 1031.3 |
| 7a73f4dd | 3a40e85f (removed) | 11 | 10-23 23:28:02 | 59.8 | overrun | no revision, no wait found |  | 1 + 1 | 64.4 to 36.4 | not all started | 0.7 |
| 064d17a3 | bcf1abf6 (live) | 4 | 10-24 06:26:30 | 132.9 | remainder | r56 | 6.8 | 4 + 0 | 507.7 to 531.5 | 117.2 | 43.4 |
| 7f12c3e8 | bcf1abf6 (live) | 4 | 10-24 06:34:25 | 96.5 | remainder | no revision, no wait found |  | 2 + 0 | 183.3 to 192.9 | 194.5 | 0.4 |
| 63ff0ecf | bcf1abf6 (live) | 9 | 10-24 06:40:59 | 45.0 | remainder | no revision, no wait found |  | 6 + 0 | 252.7 to 269.8 | 401.5 | 0.5 |
| 4c29626b | bcf1abf6 (live) | 4 | 10-24 10:11:01 | 65.8 | remainder | a wait that named 1 cut file | 0.7 | 3 + 0 | 189.9 to 197.4 | 116.2 | 0.3 |
| 3142c25d | d3b6399f (live) | 4 | 10-24 10:52:22 | 59.7 | overrun | a wait that named 1 cut file | 4.9 | 0 + 2 | 18.6 to 65.7 | not all started | 0.6 |
| 03e1d628 | d3b6399f (live) | 4 | 10-24 10:53:23 | 120.5 | overrun | r6 | 26.5 | 0 + 1 | 42.6 to 74.8 | -45.7 | 18.3 |
| 77bc2a49 | d3b6399f (live) | 4 | 10-24 10:55:41 | 57.3 | overrun | r8; a wait, named file next | 33.4 | 1 + 1 | 62.6 to 17.1 | not all started | 0.8 |
| 31997ecb | d3b6399f (live) | 3 | 10-24 10:58:58 | 13.4 | neither | r11 | 3.0 | 1 + 0 | 9.0 to 13.4 | 5.6 | 1.4 |
| c46b73ff | b7555ac0 (live) | 4 | 10-24 11:07:59 | 165.2 | overrun | a wait that named 3 cut files | 4.9 | 0 + 4 | 541.3 to 660.9 | 480.5 | 1.1 |
| 7c46709b | 87db4ccb (live) | 4 | 10-24 11:08:01 | 226.5 | overrun | a wait that named 1 cut file | 4.9 | 1 + 0 | 191.3 to 201.9 | -24.6 | 2.4 |
| 1e292ecc | 87db4ccb (live) | 4 | 10-24 11:12:41 | 72.5 | overrun | a wait, named file next | 3.3 | 2 + 0 | 63.3 to 127.5 | -4.0 | 1.2 |
| 48a776e6 | 48f74c52 (live) | 4 | 10-24 11:19:40 | 35.9 | remainder | r8; a wait, named file next | 10.0 | 0 + 0 | 0.0 to 0.0 | none cut | 0.4 |
| 9178590d | 48f74c52 (live) | 2 | 10-24 11:34:35 | 125.7 | overrun | a wait, named file next | 3.6 | 1 + 0 | 121.0 to 125.7 | 22.6 | 1.3 |

*Read from the store copies, their run logs and transcripts* (`results/table-*.md`, `results/match-*.jsonl`).

| | squeal | cezar |
|---|---|---|
| Rule B (probe): remainder, overrun, overrun at 30 s, neither: yields | 8, 12, 7, 4 | 29, 18, 4, 4 |
| the same: cut files, cut s low to high | 17, 365 to 655; 22, 239 to 927; 16, 10 to 462; 5, 74 to 252 | 61, 5,208 to 5,543; 37, 2,076 to 2,428; 4, 17 to 125; 4, 228 to 253 |
| Remainder past the end: over 60 s, 30 to 60 s, 10 to 30 s, 0 to 10 s, 0 or less (yields) | 18, 4, 4, 2, 2 | 24, 8, 1, 3, 6 |
| Remainder past the end: median; total | 71.4 s; 3,960 s | 73.3 s; 4,801 s |
| Yields that threw away more (high) than the remainder they saved | 14: 1,166 s for 428 s | 32: 6,890 s for 2,362 s |
| Revision, no wait found: yields, cut files, cut s | 28, 48, 672 to 2,178 | 9, 18, 1,323 to 1,438 |
| Revision and a wait | 1, 2, 0 to 61 | 10, 15, 303 to 399 |
| No revision, a wait | 2, 10, 15 to 58 | 25, 48, 4,207 to 4,682 |
| No revision, no wait found | 0 | 11, 25, 1,696 to 1,830 |
| Next tier after the end: median; over 5 s | 0.2 s; 2 | 0.7 s; 10 |

- **R1. Each yield met rule B on the daemon's estimate.** Only `#decide`'s two branches give the cause: a remainder over `YIELD_REMAINDER_MS` at an event, or an overrun of 30 s, at an event or at `boundOf`'s timer (`src/core/scheduler/yields.ts:205` and `:207`; *read in source code*). The walls agree. The 11 "overrun at 30 s" yields ended 30.1 to 31.7 s after the start. Of the 8 "neither" yields, 7 fit an overrun on a smaller estimate than the probe's: squeal a5b01634 on an estimate of 19.5 s, 1e6a7cee and 57a95af3 on about 30 s, 732f952d on 3.4 s; cezar 1e09718a on 6.6 s, d2054886 on 6.9 s, 4f874ee9 on 169 s. Cezar 31997ecb fits a remainder at its revision 10.4 s in, on an estimate over 40 s. *Inferred.*
- **R2. In squeal's "overrun at 30 s" yields, the daemon held no duration that the store had.** The newest stored result of `rerun-failure.test.ts` before e7795e47's start was 9.8 s (336018f5, 10-23 16:00Z). On that, the bound is 39.8 s, but the yield came at 30.1 s. `applyListing` adds a file that a later listing names with `durationMs: null` until a result applies (`src/core/scheduler/revision.ts:228`, `files.ts:102`). An install wait's end runs the baseline again, which reads durations (`install.ts` `reconcileWaiting`). Why 2ccf922d's daemon held none is *not determined* from the copies.
- **R3. Cezar's yields were mostly to named waits.** In the live worktree bcf1abf6, one Codex session ran `squeal status --wait 60000` on one long file and two or three short guard files (`test-wait-discipline.test.ts`, `contract-import-boundaries.test.ts`, `mock-source-boundary.test.ts`), again and again. Each wait promoted the guards. The tier in flight held long parity files, and its run ended 0.7 to 4.7 s after the wait (ccbb872d, 8c5addea, 4688bfd5, a3eb96f0, 0da0178f, 4c29626b). The guards' tier then ran 1.3 to 8.7 s. In removed worktree 8d98b80f (the session's folder hashes to it), a session looped `status --wait 60000` over every `*-parity.test.ts` file, about every 5.5 minutes. The waits at 18:42:11Z, 18:45:35Z, 18:51:23Z and 19:18:50Z each cut a tier of parity files (4f874ee9, 9074c84b, dd2b498a, 77d77da1: 1,144 s high), so that other parity files could run. `match.mjs` misses these four, because the loop passed its file list from Python. *Read from transcripts and the store copy.*
- **R4. Two yields re-ran the very files they cut, in the next tier.** Cezar 0196b2db cut `waits-cursor-parity.test.ts` and `waits-claude-parity.test.ts` after 144 s, both named by the live wait. The next tier ran the same two again for 542 s. Squeal 9c3cd9b3 cut `forced-requeue.test.ts` and `slow-rank.test.ts`, both named, and the next tier ran those two. A cut file that a wait selected is queued again promoted, at the same rank as the file the tier yielded to (C15), so it can lead the next tier. *Read from the store copy; the cause read in source code.*
- **R5. Where the next tier came late, the yield ran nothing sooner.** In 7 cezar yields and 2 squeal yields the next fast tier started 34 to 1,579 s after the cancelled run. In a removed worktree, a run that stored nothing under a live key is pruned (the host-load README's second limit), so a nearer next run may be gone. *Inferred.*

## 4. Letting the started modules end before the cancel

The model applies to the yields whose files all started at once (squeal 30, cezar 42). A cut file's remainder at the cancel is its later module duration less the wall. With a bound B, the cancel waits until the files in flight end or B passes. A file whose remainder is at most B is kept. The work waits the longest remainder, or B when a file is left to cut (*modelled*, `probes/sum.mjs`).

| Bound | squeal: kept files, kept s (high), the work's extra wait in all, per yield | cezar: the same |
|---|---|---|
| 10 s | 12, 387 s, 269 s, 9.0 s | 24, 1,624 s, 354 s, 8.4 s |
| 30 s | 20, 725 s, 757 s, 25.2 s | 27, 1,819 s, 1,006 s, 24.0 s |
| 60 s | 27, 1,106 s, 1,328 s, 44.3 s | 45, 3,827 s, 1,817 s, 43.3 s |
| Wait only for files whose remainder is at most 30 s, with perfect estimates | 20, 725 s, 156 s | 27, 1,819 s, 105 s |
| The same with the daemon's estimates (*inferred*) | 7, 199 s, 67 s | 3, 58 s, 68 s |
| Keep a whole module that ended in the grace (011-137's rule, extended) | 0 | 0 (4 uncut, 182 s) |

- **K1. Most of the 10 s bound's gain is uncertain.** 6 of squeal's 12 and 15 of cezar's 24 kept files ran shorter in their later run than this run's wall: the later run was faster. The file in flight could have ended in 10 s, or not. The sure part is 6 files (256 s) and 9 files (534 s).
- **K2. Rule B makes the bound cost its whole length.** A remainder yield fires only when a file has more than 30 s left, so a bound under 30 s waits its full length in nearly every such yield. Only 4 squeal tiers and 9 cezar tiers would end within 10 s.
- **K3. The estimate does not tell which files end soon.** A wait on the daemon's estimate (*inferred*) keeps 3 of cezar's 27 files that ended within 30 s of the cancel, and 7 of squeal's 20. Most estimates were older and longer, or the file was already past its estimate.
- **K4. Against 001-381's trade.** The human chose rule B for a cut of the edit's wait from 39,064 s to 6,893 s in 6.5 days, for 4,454 file-seconds run again (`research/running-tier-yields.md` 4). That is about 7 s of wait saved per second of work thrown away. The 10 s bound gives back 354 s of wait in one day for 534 to 1,624 s of cezar's work. That is 1.5 to 4.6 s of work per second of wait: by the human's own trade, the wait is worth more. *Modelled.*

## 5. Options weighed

| Option | Kept on this day (cezar; squeal) | Cost to the waiting work | Verdict |
|---|---|---|---|
| Let the modules in flight end, up to 10 s | 534 to 1,624 s; 256 to 387 s | about 9 s per yield (354 s; 269 s) | rejected: half the gain uncertain, and the wait costs more than the work by 001-381's trade (K1, K4) |
| The same, up to 30 s | 1,819 s; 725 s | about 25 s per yield (1,006 s; 757 s) | rejected: same reasons, three times the wait |
| Wait only for files the estimate says end within 30 s | 58 s; 199 s | 68 s; 67 s | rejected: the estimate misses them (K3) |
| Keep a whole module that ended in the grace | 0; 0 | none | rejected: nothing to keep |
| A higher threshold than 30 s | `research/yields-replay.md` 4: 60 s throws away 17% less for 4% more edit wait | the human's 30 s | out of this row: the human chose 30 s on that evidence |
| A yield does not cut a file that has run longer than its remainder | the late cuts | the remainder, unbounded | rejected: it brings back #69's waits for any edit or named file |
| **Once a tier has run 30 s, it does not cut a file that the same or an earlier open wait selected (section 6)** | **2,452 to 2,775 s; 0** | **those waits' other files wait the tier's remainder (median 159 s); each wait as a whole returns sooner** | **proposed** |

## 6. The proposed change: a wait does not cut its own file

**The rule.** A promoted file makes a tier that has run 30 s or more yield only when it ranks before every file of the tier that has not ended. C15's rank applies: a file that an open wait selected ranks by that wait's request, and any other file ranks after every promoted file. So once a tier has run 30 s, a wait's promoted file does not cut a file that the same wait, or an earlier one, also selected. Work an edit caused, a runner part that waits for the run and a focused entry make the tier yield as today. So does a promoted file that ranks first, such as a wait that selected nothing in the tier.

**Why this one.** A named wait returns only when each file it selects has a result for its current key (005 D2). Take a wait that selects file A, in flight, and file P, queued. The yield runs P first and A again from its start. The wait then returns later, by up to the time A had run, and the work A ran is lost. Without the cut, A ends, P runs, and the wait returns sooner. Only the wait's view at its deadline loses: within `--wait 60000` it shows P's verdict when the tier yields, and P pending when it does not. Under 30 s, the cut costs little and still gives P's verdict at once, so the rule leaves those yields alone. It uses the 30 s of rule B. The rule follows C15's own rank, needs no new estimate, and stores only what a tier that ends stores today.

**On this day.** *Read from the store copy and transcripts; the counterfactual is modelled* (`probes/proposal.mjs`, `results/proposal-*.json`).

- Cezar: 16 yields cut 22 files that a live wait of the same worktree selected. In 11 of them the tier had run 31 to 351 s: 9077a52a, ec8e900c, 0196b2db, 06c55d2f, 0f9db7cc, a3eb96f0, 0da0178f, 4c29626b, 3142c25d, c46b73ff and 7c46709b. Each was one wait that also named the next tier's file, except ec8e900c, where it named none. The rule refuses 10 surely. ec8e900c is unsure: a revision may also have queued an edit's work. Kept: 23 cut files, 2,452 to 2,775 s, 33% of cezar's high bound. The promoted files in those 11 then wait for the tier's remainder: 0 to 481 s, median 159 s, 2,115 s in all. The 5 yields under 30 s (7ef80fd1, fa2ca271, 8c5addea, 4688bfd5, 8df3c6fc; 149 s high) yield as today.
- With no 30 s floor, the rule refuses 14 to 16 yields and keeps 34 files, 2,564 to 2,924 s, but the promoted files wait 2,723 s. fa2ca271 shows the cost: the guards would wait 183 s to save 7 s of work.
- Squeal: one yield cut named files (9c3cd9b3), 11.8 s into its tier. It is under the floor, so nothing changes.
- The four 8d98b80f yields of R3 (1,144 s high) are not counted, since their file lists came from Python. The figure is a lower bound.

**Recommendation.** Put the rule to the human. Rule B stays as chosen: 30 s, one cut per file and key, the overrun bound. The rule removes the yields that cut a waited file for another file of the same wait, a third of cezar's yield cost on this day, and it shortens those waits. The cost is a later verdict for the wait's short files while the wait is still open. Hold the bound of section 4.

**Seams, if built** (*read in source code*).
- `waitedFor` (`src/core/scheduler/yields.ts:287`) passes `runsSooner` to `queue.hasPromoted`. It gains a test: the tier has run under `YIELD_REMAINDER_MS`, or the file's rank is below the least rank of the tier's unfinished files (none counts as infinite).
- `Promotions.rankOf` (`promotions.ts:75`) already returns a running file's wait. A promotion holds every selected file in `files` and stays open while one of them runs (`settle` with `isRunning`). `RunQueue` gains an additive `rankOf(ref)` beside `isPromoted`.
- The wait's line names the reason. This needs an additive `TierYield` kind, `{ kind: "named" }`, accepted by `isYield` (`yields.ts`), with status's text.
- No key, store or validity change.

**Tests, red first** (`test/scheduler/`, fake runner and injected clock):
1. A tier of 4 files (200 s known) has run 40 s. A wait selects file A of the tier and a queued file P. The tier does not yield, A stores, P runs next, and the wait returns when both are current. On main, A is cut and runs twice.
2. The same at 10 s into the tier: it yields as today.
3. P selected by an earlier wait than A's: it yields as today.
4. P's wait selects no file of the tier: it yields as today.
5. An edit's work is queued as well: it yields as today.
6. The tier is past its estimate by 30 s and only P waits: it does not yield. An edit's work then makes it yield.
7. The wait's text and `--json` name the reason the tier does not yield.

**C4 text.** In step 5, the sentence "It also yields, once per file and key, when it has run 30 s past its estimate, so a promoted wait waits at most the tier's estimate plus 30 s and the cancel." gains ", unless the tier runs a file that wait selected (below)". After it:

> A promoted file makes a tier that has run 30 s or more yield only when it ranks before every file of the tier that has not ended (C15's rank: a file an open wait selected ranks by that wait's request, any other after every promoted file). So once a tier has run 30 s, it does not cut a file that the same or an earlier open wait selected for that wait's other files: the wait returns only when each file it selects is current (005 D2), and the cut would delay it by up to the time that file had run. Work an edit caused, a runner part that waits for the run and a focused entry make it yield as above; the wait's line names the reason (`named`). (Amended <date of the change>, row 011-180, `tasks/011-180/notes.md`: on cezar's store, 24 hours to 2026-10-24T13:38Z, 16 of 55 yields cut 22 files that a live wait of the same worktree had selected; in 11 the tier had run 31 to 351 s, and they cut 23 files of 2,452 to 2,775 recorded seconds; squeal had one such yield, 11.8 s in.)

**C15 text.** In Rank, "A promoted file queued behind a running tier makes it yield as C4 step 5 says: once per file and key, when its estimated remainder exceeds 30 s, never the backlog's turn." gains: ", and, once the tier has run 30 s, only when the tier runs no file that the same or an earlier open wait selected (row 011-180)". In the wait's reasons, "the reason names its remainder, the time a tier past its estimate yields at (row 011-107), a file already cut, the backlog's turn, or a runner that runs each tier to its end" gains "a file this wait or an earlier one selected (row 011-180)".

## 7. Limits

- One window of 24 hours. Squeal's yields are one worktree's evening (F3). Cezar's sit in a few agents' wait loops (R3).
- The tier's kind is not stored, so it is read from its size. The daemon's estimate is not stored, so the probe infers it (R1, R2).
- The waits come from transcripts. A path list built at run time (a Python loop, `*selected`) is not parsed. A glob is expanded over today's test files. A worktree is matched by its folder's hash. Each wait is taken as live for 62 s, as `--wait 60000`. So `match.mjs` gives lower bounds (R3). A wait in a worktree's subfolder maps to no worktree.
- The high bound uses a later run's module duration under another load. A file's low bound can exceed its high bound when the later run was faster (cezar 19ffa47b, a3eb96f0, 55e9db01, 7a73f4dd, 77bc2a49). The low bound leaves out collection, setup and hooks: F2's cut module ran 30 s with every test skipped, so its low bound is 0.
- The models of sections 4 and 6 take a file's later duration as its duration in the cut run. They do not move later events after a cut, and they leave out the reruns' own cuts.
- A removed worktree's revisions are pruned, so "a revision" there is read from the next tier's revision. Its runs that kept nothing are pruned, so its next tier may be missing (R5).

## 8. For whoever continues

- `node --disable-warning=ExperimentalWarning probes/yield.mjs <store copy> 24 <runs copy> <end ISO> [projects outside the fast Vitest lane]` prints one JSON line per yield and a summary. Cezar's extra argument is `e2e,test:unit,root:test:unit`. `probes/waits.mjs <from> <to> projects-<name>` reads the transcripts, and `probes/match.mjs <yield lines> <waits> <store copy>` matches them. `sum.mjs`, `table.mjs` and `proposal.mjs` read those outputs. All are read only.
- The seam map: the cause comes only from `#decide` (`yields.ts:181` to `:209`). What waits is `waitedFor` (`:287`): an edit's work by `hasRecentAfter`, a promoted file by `hasPromoted`, a focused entry, or a recreate. A backlog tier with an edit's work goes to the cause `backlog` first (`backlog.ts` `cancelsBacklog`), so a backlog-sized yield waited for a promoted file, a focused entry or a recreate. A promotion holds every file its wait selected (`promotions.ts`), running ones included.
- Open: why squeal's 2ccf922d daemon held no durations for files that had stored ones (R2). A first look: `applyListing`'s `addFile`, and whether the baseline there listed late. If the cause is a daemon start or a listing, the overrun at 30 s cuts any project's first long tier after it.
- The store copies and the transcript extract are in the worker's scratch folder (`t/f24c37b0/`), kept until the row's review. They go with the worker's scratch.
- If section 6 is built, its landing check is this row's probes over 24 hours: the yields with `cutNamed` over 0 and a wall of 30 s or more should be none.
