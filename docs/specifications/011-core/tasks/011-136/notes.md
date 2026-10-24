# 011-136: the backlog files an edit's cancel cut after they started

Worker 1ac8625f, wave 30 W7 (`tasks/wave-30.md`), from main at 1fec05b84, 2026-10-24. Shape: survey. No product change.

## Answers

1. **Started and cut, 24 hours to 2026-10-24T09:22:15Z.** Squeal: 95 files in 19 tiers that an edit's cancel cut, 321 to 915 recorded seconds. Cezar: 40 files in 19 tiers, 391 to 691 s. That is 0.3% and 0.2% of the day's picked files (30,566 and 20,257), and at most 0.4% and 0.2% of the day's recorded seconds (224,591 s and 347,420 s).
2. **The count the brief names misses most of them.** In `waste.mjs`'s `cancelled` table, `neverEnded` minus `neverStarted` gives 15 and 0. A module that the cancel cut still ends: Vitest marks its remaining tests skipped, and the module ends `passed` after the log's cancel note. The report drops it, and `neverEnded` counts it as ended (section 2, F1).
3. **The cancels came after quiets longer than 20 s, and the quiet applied.** 13 of squeal's 19 tiers and 15 of cezar's 19 started 20 s or more after the last revision. They hold 86 of the 95 and 37 of the 40 cut files. 9 tiers started when a wait ended: 20 s after a cancel (5) or 120 s after an edit's catch-up (4). No squeal tier surely started under 20 s; two cezar tiers did, with 1 cut file of 0.3 s (section 3).
4. **Why then: the agent's next edit came while the tier ran,** 1.3 to 382 s into it (median 37.6 s squeal, 25.6 s cezar). The pause between the two edits was longer than the wait and shorter than the wait plus the tier. The 4 tiers that waited 120 s were cut after the wait too, and cost more than the 5 that waited 20 s (42 files against 11), so a longer quiet moves the cut and does not remove it. In cezar, about half or more of the cut seconds came from edits of slow-lane e2e files, which reach the Vitest lane only through files that read e2e files.
5. **The cost is a few long files.** In tiers that ran in pick order (shortest first), the files in flight at the cancel were the tier's longest. Six tiers hold 570 of the 712 low-bound and 1,055 of the 1,606 high-bound seconds of both projects.
6. **One change:** a backlog tier that has started every file it picked is not cut by an edit's work while a file in flight has run 30 s or more; the edit waits for the tier, at most 30 s (section 5). On this day it applies to 2 cancels, both in cezar: one tier ends 17 s later and keeps 204 s, the other is cut at 30 s and loses 30 s more. **Recommendation: hold it.** The row's measured target already holds: files lost to this cause are 0.62% (squeal) and 0.27% (cezar) of picked files, under 5%. Fix the count instead (section 6).

## 1. Sources

- Copies of this host's two stores, each with its `-wal` and `-shm`, then its run logs, back to back: squeal's copy ended at 09:22:21Z and cezar's at 09:22:26Z, under `nice -n 10` and `ionice -c3` (load 54.9 on 24 CPUs). Read only, in the worker's scratch directory. No live store or socket was opened, no test or eval ran.
- `waste.mjs` from main at 1fec05b84 on both copies, 24 hours to 2026-10-24T09:22:15Z (`probes/results/waste-*.json`).
- Two probes in this folder, each read only on a copy: `probes/cut.mjs` (each tier the cause "an edit arrived during a backlog tier" cancelled, file by file, with the revisions and runs around it) and `probes/order.mjs` (the order the tier's modules ended in, and a model of a longest-first order). Their output for this window is in `probes/results/`. Short scratch scripts read the events around a run, a later run's test durations and the store's schema; their results are quoted below.
- Source read: Vitest 5.0.3 (`node_modules/vitest/dist/chunks/index.DpLw24bj.js`, `index.ggMXe2IF.js`), `src/core/scheduler/{quiet,yields,backlog}.ts`, `src/runners/vitest/reporter.ts`, both projects' `squeal.config.json`. Both run `baseline.onStart: "lookup-only"`, so a backlog tier holds catch-up, `run --all` checkpoints and re-runs, not misses.

Evidence tags as in `docs/process.md`: *read from the store copy*, *read from run logs*, *read in source code*, *inferred*, *modelled*.

## 2. What the cancels cut

| 24 h to 09:22:15Z | squeal | cezar |
|---|---|---|
| Tiers with the cause "an edit arrived during a backlog tier" | 19 | 19 |
| Files picked | 2,416 | 1,424 |
| Ended before the cancel (the report's `completedFiles`) | 1,178 | 688 |
| of them kept a result (stored now, or pruned with a removed worktree) | 1,176 | 506 |
| Ended before the cancel and withheld by the adapter | 53 | 0 |
| **Started and cut: ended in the grace (the report drops it)** | **80** | **40** |
| **Started and cut: never ended** | **15** | **0** |
| Never started | 1,090 | 696 |
| of them handed over (a later run of the worktree picked them) | 996 | 682 |
| Lost as C3 reads it: started and cut, or never started and not handed over | 189 (0.62% of 30,566) | 54 (0.27% of 20,257) |
| **Recorded seconds of the started-and-cut files, low to high** | **321 to 915** | **391 to 691** |

*Read from the store copies and their run logs* (`probes/cut.mjs`). A file "ended in the grace" has its `MODULE` line after the log's note `squeal: run cancelled: …`; one that "never ended" is named by a `PASS`, `FAIL`, `SKIP` or console line and has no `MODULE` line. Low: the durations of the file's tests that the log reports passed or failed in the run, which ran. High: the file's module duration in the next run of its worktree that reports one, at most the cancelled run's wall; the wall when no later run reports it (4 files).

- **F1. `neverEnded` minus `neverStarted` counts 15 and 0 where 95 and 40 started and were cut.** Vitest's cancel skips the test that is running and every later test of the module (011-137's probe), so a module in flight ends `passed` soon after the note, with `SKIP … (0 ms)` lines. The report drops it (`afterCancel`, `src/runners/vitest/reporter.ts`), and the successor runs it again: 94 of squeal's 95 and 37 of cezar's 40 ran in a later run in the copy. *Read from run logs.*
- **F2. No cut module was whole.** 011-137's rule (each test the module was to run reported its result before the cancel) reads 0 of the 120 grace-ended modules as whole. 23 (18 squeal, 5 cezar) had no skipped test, only results that arrived after the note; they ran 8.5 s and 11 s. So 011-137's keep, extended from the step-down to this cause, would keep nothing, and a looser rule at most 20 s a day. *Read from run logs.*
- **F3. Six tiers hold most of the seconds.** Squeal `9f05221c` (136 to 310 s), `a7438d76` (64 to 220 s), `56e3cf6d` (74 to 159 s); cezar `396671a7` (206 to 210 s), `b2401e24` (24 to 83 s), `50a9907e` (66 to 73 s). The largest single file is cezar's `worker-parent-attention.test.ts`, 302 s in its next run: the cancel came after 79 of its 85 tests had passed, and the 6 it cut took 16.7 s in that run. *Read from run logs.*
- **F4. In tiers that ran in pick order, the cut files are the tier's longest.** C4 step 4 picks shortest first, and Vitest keeps that order when its results cache lacks the files, as in a new worktree (`tasks/011-82/design.md` 1.4). In squeal's 9 tiers whose modules ended in pick order (Spearman's rho over 0.5, `probes/order.mjs`), the cut files sat at the end of the pick list: `9f05221c` at positions 174 to 198 of 200, `a7438d76` 72 to 111 of 120, `56e3cf6d` 82 to 113 of 155. Those 9 tiers hold 59 of squeal's 95 cut files and 282 to 729 of its seconds. *Read from the store copy and run logs.*
- **Other losses in the same tiers, not cuts.** Squeal `fb0bba5e` withheld 53 ended files under 001-146's whole-run fallback (`src/core/status/focused.ts` changed on disk during the run). Cezar's 182 ended files without a result are 148 in `128d11f8`, whose cancelling revision changed `package.json` (an input of every key, so the stability check discarded them), and 34 in 9 other tiers (stability discards or a later run at the same key).
- **Never started and not handed over:** squeal 94, of which 80 in `c44abe13` and 14 in `f4345725`, both in removed worktrees. The prune deletes a removed worktree's later runs that kept nothing under a live key, so their successors may be gone (the README's second limit); 94 is an upper bound of the loss.

## 3. When the cancels came, against the quiet

"Quiet before the start" is the time from the last revision to the tier's start. In a live worktree it is exact. A removed worktree's revisions are pruned, so it is bounded: at least the time from the first run at the tier's revision, less than the time from the last run at an earlier revision. "Cancel" is the time from the start to the cancelling revision (live) or to the report's end, which comes at most about 1 s after the cancel (removed). "The cancelling edit" is the revision's paths (live) or the first file of the edit's tier that ran next (removed).

Classes: *20 s wait* and *120 s wait*: an earlier cancel, or an edit's catch-up, started a wait (`BacklogQuiet`, `src/core/scheduler/quiet.ts`), and the tier started within 10 s of its end (`26d7dc13` *inferred*: the cancel of `1489e59f` ended 18 s before its start); *20 to 120 s* and *over 120 s*: no wait ended at the start; *checkpoint*: a `run --all` tier, which ends every wait; *not known*: the bounds hold 20 s.

### squeal

| Run | Worktree | Picked | Start (UTC) | Quiet before the start, s | Class | Cancel, s into the tier | The cancelling edit | Ended before the cancel (kept) | Cut: grace + in flight | Cut s, low to high | Never started (handed over) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| c44abe13 | d58b598b (removed) | 200 | 10-23 17:05:01 | 15.8 to 23.5 | not known | about 2.4 | next run: `git-layout.test.ts` | 1 (1) | 4 + 0 | 0 to 1 | 195 (115) |
| f4345725 | 844141f8 (removed) | 27 | 10-23 20:18:25 | no other run | not known | about 64.4 | no later run | 12 (12) | 1 + 0 | 0 to 65 | 14 (0) |
| 0222a59d | 31299079 (removed) | 200 | 10-23 21:20:03 | 211.6 to 356.6 | over 120 s | about 58.9 | next run: `former-read.test.ts` | 124 (124) | 3 + 0 | 3 to 11 | 73 (73) |
| a0e1bd72 | 31299079 (removed) | 33 | 10-23 21:32:44 | 0.0 to 102.9 | checkpoint | about 5.1 | next run: `pnpm-install.test.ts` | 1 (1) | 1 + 0 | 0 to 4 | 31 (31) |
| 1489e59f | 31299079 (removed) | 200 | 10-23 23:03:41 | 165.3 to 234.3 | over 120 s | about 82.6 | next run: `pnpm-lockfile.test.ts` | 131 (131) | 6 + 0 | 2 to 6 | 63 (63) |
| 26d7dc13 | 31299079 (removed) | 123 | 10-23 23:05:25 | 17.3 to 103.9 | 20 s wait (inferred) | about 33.2 | next run: `former.test.ts` | 12 (12) | 2 + 1 | 10 to 29 | 108 (108) |
| eb479897 | 31299079 (removed) | 110 | 10-23 23:12:59 | 202.0 to 257.3 | over 120 s | about 74.1 | next run: `pnpm-graph.test.ts` | 58 (58) | 4 + 1 | 20 to 36 | 47 (47) |
| c6d0b0fa | 2cc9bb41 (removed) | 12 | 10-24 02:54:16 | 3.7 to 131.8 | not known | about 17.2 | next run: `absent-paths.test.ts` | 8 (8) | 0 + 2 | 6 to 35 | 2 (2) |
| f59a928a | 6928333e (removed) | 114 | 10-24 03:42:11 | 20.0 to 24.3 | 20 s wait | about 21.5 | next run: `status-wait-focus-unqueued.test.ts` | 113 (113) | 1 + 0 | 0 to 1 | 0 (0) |
| 65251bef | 6928333e (removed) | 200 | 10-24 03:49:25 | 120.0 to 147.1 | 120 s wait | about 7.7 | next run: `status-wait-focus-capped.test.ts` | 74 (74) | 16 + 0 | 0 to 7 | 110 (110) |
| b8c48735 | f3b80edf (removed) | 200 | 10-24 05:23:22 | 120.0 to 177.2 | 120 s wait | about 2.5 | next run: `tier-yields-claim.test.ts` | 50 (50) | 16 + 0 | 2 to 5 | 134 (134) |
| a7438d76 | f3b80edf (removed) | 120 | 10-24 05:24:11 | 29.8 to 45.8 | 20 to 120 s | about 52.1 | next run: `tier-yields-ended.test.ts` | 96 (96) | 11 + 1 | 64 to 220 | 12 (12) |
| 9f05221c | 672dac60 (removed) | 200 | 10-24 05:33:23 | 120.2 to 126.4 | 120 s wait | about 189.0 | next run: `step-down-keeps.test.ts` | 189 (189) | 5 + 3 | 136 to 310 | 3 (3) |
| 56e3cf6d | 672dac60 (removed) | 155 | 10-24 05:39:34 | 147.7 to 371.9 | over 120 s | about 190.7 | next run: `step-down-keeps.test.ts` | 99 (99) | 6 + 5 | 74 to 159 | 45 (45) |
| 1cfeee69 | f3b80edf (removed) | 2 | 10-24 05:46:52 | 0.0 to 97.9 | not known | about 68.6 | next run: `version-sensitive.test.ts` | 1 (1) | 0 + 0 | 0 | 1 (1) |
| fb0bba5e | 8c1e4717 (removed) | 155 | 10-24 06:33:10 | 163.6 to 169.8 | over 120 s | about 36.2 | next run: `named-file-lines.test.ts` | 3 (3) | 1 + 0 | 1 to 1 | 98 (98) |
| da2a5936 | 43e974b3 (removed) | 168 | 10-24 07:38:46 | 120.6 to 151.4 | 120 s wait | about 37.6 | next run: `wasm.test.ts` | 92 (92) | 1 + 1 | 2 to 13 | 74 (74) |
| be07721a | 4e226cfc (removed) | 3 | 10-24 07:41:41 | 15.6 to 66.6 | not known | about 1.3 | next run: `daemon-loop.test.ts` | 2 (2) | 1 + 0 | 0 to 2 | 0 (0) |
| ad4d5c1b | 1ec1d043 (live) | 194 | 10-24 09:13:55 | 184.1 | over 120 s | 39.8 | r12: `focused.test.ts` | 112 (110) | 1 + 1 | 0 to 8 | 80 (80) |

### cezar

| Run | Worktree | Picked | Start (UTC) | Quiet before the start, s | Class | Cancel, s into the tier | The cancelling edit | Ended before the cancel (kept) | Cut: grace + in flight | Cut s, low to high | Never started (handed over) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 26a097bd | e8430563 (removed) | 7 | 10-23 10:54:04 | 8.3 to 1443.8 | not known | about 14.2 | next run: `view.test.ts` | 2 (2) | 2 + 0 | 16 to 29 | 3 (1) |
| 0bca69db | a6e709c7 (removed) | 10 | 10-23 15:58:47 | at least 2.9 | not known | about 23.3 | next run: `change-surface-readers.test.cjs` | 9 (9) | 0 + 0 | 0 | 1 (1) |
| fa6da9e2 | f551453a (removed) | 106 | 10-23 16:07:01 | 1483.4 to 3798.5 | over 120 s | about 25.6 | next run: `contract-import-boundaries.test.ts` | 8 (8) | 2 + 0 | 4 to 12 | 96 (96) |
| f9339e7c | 8d98b80f (live) | 200 | 10-23 16:40:33 | 34.1 | 20 to 120 s | 20.6 | r3: `client.ts` and 17 more | 87 (87) | 7 + 0 | 20 to 59 | 106 (106) |
| 1be4a376 | 8d98b80f (live) | 160 | 10-23 16:41:22 | 28.7 | 20 s wait | 9.6 | r4: `server.ts` and 3 more | 24 (3) | 3 + 0 | 19 to 53 | 133 (133) |
| 3462bc5c | d9f330ec (removed) | 126 | 10-23 16:48:32 | at least 29.6 | 20 to 120 s | about 105.5 | next run: `allowed-tools.test.ts` | 111 (111) | 2 + 0 | 0 to 2 | 13 (11) |
| dc182071 | a243c6b5 (live) | 200 | 10-23 17:24:08 | 382.9 | over 120 s | 22.5 | r5: `automations-api.test.ts` | 176 (175) | 4 + 0 | 4 to 9 | 20 (20) |
| 396671a7 | bcf1abf6 (live) | 3 | 10-23 20:47:15 | 1684.3 | over 120 s | 208.8 | r36: `tab-coordination.e2e.ts` | 2 (2) | 1 + 0 | 206 to 210 | 0 (0) |
| b00f509b | 8d98b80f (live) | 2 | 10-23 20:51:53 | 2986.3 | over 120 s | 381.8 | r41: `new-task-plan.ts` | 2 (0) | 0 + 0 | 0 | 0 (0) |
| 128d11f8 | 773ade11 (live) | 200 | 10-23 21:05:18 | 3.3 | under 20 s | 74.5 | r4: `README.md` and 2 more | 148 (0) | 1 + 0 | 0 to 0 | 51 (51) |
| 7172126a | 773ade11 (live) | 48 | 10-23 21:25:39 | 28.2 | 20 to 120 s | 42.0 | r12: `SKILL.md` and 5 more | 30 (30) | 1 + 0 | 0 to 3 | 17 (17) |
| 792b1953 | 3a40e85f (live) | 12 | 10-23 21:37:37 | 315.5 | over 120 s | 99.8 | r13: `turn-end.testkit.ts` | 9 (4) | 1 + 0 | 0 to 103 | 2 (1) |
| 9a06da74 | 773ade11 (live) | 31 | 10-23 21:57:09 | 960.4 | over 120 s | 13.6 | r25: `worker-conversation.e2e.ts` | 1 (1) | 4 + 0 | 30 to 53 | 26 (26) |
| 58a81f5c | 773ade11 (live) | 7 | 10-23 22:03:22 | 33.5 | 20 to 120 s | 14.2 | r32: `tool.md` and 1 more | 2 (0) | 0 + 0 | 0 | 5 (5) |
| 50a9907e | bcf1abf6 (live) | 1 | 10-23 22:05:45 | 2117.5 | over 120 s | 71.2 | r52: `worker-conversation.e2e.ts` | 0 (0) | 1 + 0 | 66 to 73 | 0 (0) |
| 71aa297b | 773ade11 (live) | 200 | 10-23 22:19:51 | 21.9 | 20 s wait | 49.8 | r37: `waits-parity-cells.testkit.ts` | 49 (46) | 0 + 0 | 0 | 151 (151) |
| 03801cff | bcf1abf6 (live) | 52 | 10-23 22:38:39 | 67.0 | 20 to 120 s | 5.7 | r55: `automations-api.test.ts` | 18 (18) | 7 + 0 | 0 to 1 | 27 (27) |
| b2401e24 | 3a40e85f (live) | 58 | 10-23 22:44:29 | 29.1 | 20 s wait | 57.4 | r17: `automations-api.test.ts` | 10 (10) | 4 + 0 | 24 to 83 | 44 (35) |
| b8a13845 | 250381d8 (live) | 1 | 10-24 09:13:48 | 16.2 | under 20 s | 3.0 | r6: `ask-answers.tsx` | 0 (0) | 0 + 0 | 0 | 1 (1) |

*Read from the store copies and run logs* (`probes/cut.mjs`, `probes/results/cut-*.jsonl`).

| Class | squeal: tiers, cut files, cut s | cezar: tiers, cut files, cut s |
|---|---|---|
| 20 s wait | 2, 4, 10 to 30 | 3, 7, 44 to 136 |
| 120 s wait | 4, 42, 140 to 336 | 0 |
| 20 to 120 s, no wait at the start | 1, 12, 64 to 220 | 5, 17, 21 to 66 |
| over 120 s | 6, 28, 101 to 222 | 7, 13, 311 to 461 |
| checkpoint | 1, 1, 0 to 4 | 0 |
| under 20 s | 0 | 2, 1, 0 |
| not known | 5, 8, 6 to 104 | 2, 2, 16 to 29 |

- **T1. The quiet applies.** Where an earlier cancel or an edit's catch-up started a wait, the tier waited for it: 9 tiers started within 10 s of a wait's end, 8 of them within about 3 s (the squeal ones inferred from the bounds). The others started after longer quiets with no wait in force. The two cezar tiers under 20 s had no wait to apply: `128d11f8` started 3.3 s after a revision in a daemon 145 s old with no earlier cancel, and `b8a13845` was the first backlog tier after its edit's. *Read from the store copy.*
- **T2. The next edit came during the tier.** It came 1.3 to 190.7 s into a squeal tier (median 37.6 s) and 3.0 to 381.8 s into a cezar tier (median 25.6 s). The edits behind the six costly cuts came after pauses of at least 309 s (`9f05221c`), 338 s (`56e3cf6d`) and 82 s (`a7438d76`), and of 1,893 s (`396671a7`), 2,189 s (`50a9907e`) and 86.5 s (`b2401e24`), from the revision before. A quiet of Q holds a tier only when the next edit comes within Q. A 120 s quiet for every backlog tier holds 2 of the 6 (88 to 303 s); the other 4 need 5 minutes or more. And the 4 tiers that already waited 120 s were cut after it: 42 files, 140 to 336 s, more than the 20 s class. *Read from the store copy; the consequence inferred.*
- **T3. In cezar, edits of slow-lane e2e files cut about half of the seconds or more.** `396671a7`, `50a9907e` and `9a06da74` were cancelled by an edit of a `packages/web/e2e/*.e2e.ts` file, which cezar's `slow.include` puts in the slow lane. The edit queued work in the Vitest lane only through files that declare or read e2e files at run time (`design-guardian.test.ts`, `contract-import-boundaries.test.ts`, `e2e-wait-discipline.test.ts`), whose tier ran 3 to 4 s. These cancels cut 302 to 336 s. *Read from the store copy, its run logs and cezar's `squeal.config.json`.*
- **T4. A run of tiers.** 5 squeal and 2 cezar tiers started under 2 s after a backlog tier of the same worktree that had finished: the backlog ran tier after tier, and the edit came during a later one. *Read from the store copy.*

## 4. Options weighed

| Option | Kept on this day | The edit's wait | Verdict |
|---|---|---|---|
| Keep a whole grace-ended module under this cause too (011-137's rule, extended) | 0 by the rule; at most 20 s by a looser one (F2) | none | rejected: nothing to keep |
| A longer quiet (120 s after a cancel, as catch-up's) | at most 54 to 166 s, the 20 s class; the 120 s class shows that tiers held longer are cut later (T2) | none; the backlog waits up to 100 s more after each cancel | rejected |
| Longest first inside a backlog tier (011-82 Q6, other way round) | *modelled* at fitted widths: squeal's pick-order tiers 521 s cut to 219 s, cezar's 46 s to 184 s, mixed tiers worse in both; about no gain in all (`probes/order.mjs`) | none | rejected: an early cancel then cuts the long files |
| Hold a long file until the quiet is as long as it | none of the timed cut files: their quiets were longer than they | none | rejected; 004 also rejects marking files by measured duration (004 Non-goals) |
| Cancel the queue only and let the files in flight end | the cut files whose rest is short | the longest rest in flight | rejected: Vitest 5.0.3's `cancel()` drops the queue and cancels the active tasks in one call (`index.DpLw24bj.js:11567`), as 011-82 section 8 says |
| An edit's work reached only through a path a run read cancels no backlog tier | cezar 302 to 336 s (T3); squeal none | the tier's rest for those files, 17 s to over 60 s | rejected: it reverses row 011-116, which made those files an edit's work so they do not wait |
| **The backlog's tail (section 5)** | **cezar about 174 s; squeal none** | **17 s and 30 s, in 2 of 38 cancels** | **proposed, to hold** |

## 5. The proposed change: the backlog's tail is not cut

**The rule.** A Vitest backlog tier whose every picked file has started is not cancelled by an edit's work while one of its files in flight has run 30 s or more. The edit's tier waits for the tier's end, at most 30 s, and the tier is then cancelled as today. A revision that changes an input of the tier still cancels it at once, since the stability check would discard those results.

**Why this one.** When every file has started, a cancel saves the edit only the wait for the files in flight, and it throws away what they ran. A file in flight that has run 30 s costs at least as much run time as the edit's longest wait under the rule. It holds in any project, needs no estimate, and stores only what a tier that ends stores today.

**On this day** (*read from the store copy and run logs*; the counterfactual *inferred*). 5 of the 38 cancels came after every file of the tier had started (`f59a928a`, `be07721a`, `396671a7`, `b00f509b`, `50a9907e`). Two of them had a file in flight for 30 s or more:

- `396671a7` (cezar): `worker-parent-attention.test.ts` had run about 204 s; its 6 cut tests took 16.7 s in its next run. The tier ends about 17 s after the edit and keeps the file; the edit's tier, 3 s of `design-guardian.test.ts` and `contract-import-boundaries.test.ts`, starts about 17 s later.
- `50a9907e` (cezar): `waits-opencode-parity.test.ts` had run about 72 s; its 14 cut tests took 39.3 s. At 30 s the tier is cancelled as today, and the file loses 30 s more; the edit waits 30 s.

Net: about 174 s kept a day, 0.05% of cezar's recorded seconds; squeal none, since each of its costly tiers had files that had not started. The edits waited 17 s and 30 s, where a cancel today takes a median of 1.4 to 4.6 s (`tasks/011-82/design.md` 1.3).

**Recommendation.** Hold the rule. The row's measured target holds without it (section 2), and on this day it keeps one file. Build it if a later day's count, with the fix of section 6, shows started-and-cut seconds in tiers whose every file had started.

**Seams, if built.** `moduleQueued` (`src/runners/vitest/reporter.ts:121`) already counts each module that Vitest queues, and Vitest sends that event from the worker at `onCollectStart` (`index.ggMXe2IF.js:153`), so it marks a start (*read in source code*). An additive `RunOptions.fileStarted?(testFile)` beside `fileEnded` (`src/core/types/runner.ts:274`) gives the scheduler each start; `Tier` keeps the start times. `cancelsBacklog` (`src/core/scheduler/backlog.ts`) returns false for an edit's work alone when the rule holds; `TierYields.check` (`yields.ts`) sets a bound at 30 s, as the yield rule's `boundOf` does, and cancels at it with the cause `backlog`. The wait's line names the time, as the yield's line does. No key, store or validity change.

**Tests, red first** (`test/scheduler/`, fake runner and injected clock): a 3-file backlog tier, all started, one file 40 s in, an edit of a test file outside it: the tier is not cancelled, it ends 10 s later and stores all three, and the edit's tier runs next; the same with no end: cancelled at 30 s, the edit's tier runs; a tier with a file not started, or with its files in flight under 30 s, is cancelled at once as today; a revision that changes an input of the tier cancels it at once; a node:test or pytest lane is unchanged.

**C4 text.** In step 5, after "A backlog tier in flight is cancelled by a revision whose content re-key queues work an edit caused in the tier's lane, or that changes an input of the tier (its results would be discarded).":

> A Vitest backlog tier that has started every file it picked (Vitest queued each module on a worker) and that has a file in flight that has run 30 s or more is not cancelled by work an edit caused alone: the edit's tier waits for its end, at most 30 s (`BACKLOG_TAIL_MS`), and then the tier is cancelled as above; the wait's line names that time. A revision that changes an input of the tier still cancels it at once. (Amended 2026-10-2x, row 011-136, `tasks/011-136/notes.md`: on the squeal and cezar stores, 24 hours to 2026-10-24T09:22Z, edits cancelled 38 backlog tiers and cut 135 files that had started, 712 to 1,606 recorded seconds; in two cezar tiers every file had started, and a file in flight had run 72 s and 204 s.)

**C3 text.** The criterion's target does not change. In the README's "Files that never started (row 011-138)", after the `neverStarted` bullet, the count of section 6, so that the landing check can read the rule's effect:

> - `cut`: a file the run picked that its `vitest.log` names, that the report did not complete, and whose module did not end before the log's cancel note (`squeal: run cancelled`): it started and the cancel cut it. A module that ends after the note ended in the grace with its remaining tests skipped, and the report drops it (row 011-136). In `cancelled`, `cut` and `cutSeconds` (each file's later module duration, at most the run's wall) replace the reading of `neverEnded` minus `neverStarted`.

## 6. Proposed change to the measurement (`research/probes/host-load/`, not this row's)

`waste.mjs` reads a module's end anywhere in the log as ended (`namedIn`, the `MODULE` branch), so `neverEnded` minus `neverStarted` reads a cut module as ended (F1). The fix, for the probes' owner: track the line `squeal: run cancelled` in `namedIn`, give `ended` only the `MODULE` lines before it, and add to each `cancelled` cause `cut` (named in the log, not in the report's `completedFiles`, and with no `MODULE` line before the note) and `cutSeconds`. With `ended` read before the note, `neverEnded` is `cut` plus `neverStarted`, so the table gives the cut. The `completedFiles` clause keeps a step-down's whole module, which 011-137 completes from the grace, out of `cut`. `probes/cut.mjs`'s `parse` is the reference. Its numbers for this window: squeal `cut` 95, cezar 40, against today's 15 and 0. The README text is in section 5.

## 7. Limits

- One window of 24 hours, on the daemons of that day (the versions per run are not in the store).
- A removed worktree's revisions are pruned, so 18 of squeal's 19 and 4 of cezar's 19 quiets are bounds, and 5 and 2 cannot be classed. The prune also deletes a removed worktree's runs that kept nothing under a live key: tiers that kept nothing, and successors, are missing from those worktrees, so the counts there are lower bounds and `handedOver` too.
- The high bound of cut seconds uses a later run's module duration under another load; the low bound leaves out collection, setup and hooks.
- The model of section 4 fits one width per tier to the files ended by the cancel; fits miss by 10 to 52 files in 7 tiers. It is a direction, not a figure.
- A test line that reached the reporter before the cancel was asked can be written after the note (011-137, 100 ms throttle). F2's 23 uncut modules are the upper bound of that.

## 8. For whoever continues

- `node --disable-warning=ExperimentalWarning probes/cut.mjs <store copy> 24 <runs copy> <end ISO>` prints one JSON line per cancelled backlog tier and a summary; `probes/order.mjs` with the same arguments prints the order and the model. Both read copies only.
- The store copies of this survey are deleted; `probes/results/` keeps the probes' outputs for this window.
- If section 5 is built, its landing check is the daily's `cancelled` table with `cut` and `cutSeconds` (section 6) over 24 hours, read against section 2.
