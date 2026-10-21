# 001-381: a running tier yields to a newer revision or a named wait

Researcher R1 of 011 wave 7, 2026-10-21, worktree `cez/120dbf3e` at 70a0fe00 (main after 9ba34257; `package.json` 0.1.235). Read: `docs/vision.md`, `docs/styleguide.md`, board row 001-381, spec 011 C4 (steps 4 and 5, the timeout split, tier sharing, lanes, the stability check) and C15, `status.md`, `research/issue-63.md`, `research/issue-51.md`, `research/catch-up.md`, `research/streaming-lanes.md`, `research/backlog-wall-budget.md`, 013 `research/issue-62.md`, [#69](https://github.com/hearsay-tools/squeal/issues/69) and its comment.

Load and isolation: **no live measurement ran.** The one-minute load was 26 to 44 on 24 CPUs for the whole session, above the hold at 8. Every number is a replay of recorded data, read only: cezar's store, copied once through a `readOnly` connection at 08:12Z (1,870 fast Vitest runs in 53 worktrees, 2026-10-14T19:55Z to 10-21T08:12Z, Squeal up to 0.1.235, Vitest 4.1.10); cezar's run logs (`report.json`); the named `squeal status --wait` calls in cezar's Claude Code and Codex transcripts; `sar -q` for the load at the time. The recorded load at the replayed events was p50 41 to 53, p90 66 to 73, below 8 for 13 of 263 revisions and 4 of 66 waits (`results/load.txt`). Probes: `probes/running-tier-yields/` (README lists each).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | The seam, and a cancel's cost | `selectTier` gives only a backlog tier an `AbortController` (`startTier(..., cancellable)`); `#cancelBacklogs` aborts only `tier.cancel`; `cancelsBacklog` already tests "an input of the tier changed". The abort reaches `execute` in `src/runners/vitest/run.ts`, `recordTier` keeps modules that ended before the cancel and re-queues the rest uncounted. The 001-179 split works for any tier of 2 or more fast files, but only on a timeout. Cost on cezar's real child processes: revision to run end p50 3.1 s, p90 8.9 s, at a load of p50 52 (41 cancels); 1 of 44 cancels dropped the instance ("workers did not stop") | read in source code; verified from the store |
| 2 | The rule, per case | Cancel, never split, in Vitest: a Vitest cancel cuts the files in flight, so a run has no file boundary to stop at. (b) superseded: cancel always, no bound, since nothing valid is lost. (a) and (c): cancel when an edit's work or a promoted file is queued in the lane and the tier's estimated remainder exceeds 30 s. Fairness: one such cut per file and key. Finished files keep their results under the stability check, as for a backlog cancel today | read in source code (Squeal, Vitest 4.1.10); verified by replay |
| 3 | How often | Over 6.5 days: 233 revisions reached a fast Vitest file while a tier ran (36 a day), in 125 of 1,870 tiers; 37 of them were cancelled today, the other 196 waited p50 126 s, p90 542 s. 66 named-wait episodes (10 a day, 96 waits) were behind a tier: p50 96 s, p90 359 s, max 564 s; 32 named a file that had failed. gh-62 does not bias this: the scheduler's per-file duration is Vitest's module duration, and a single-file run's wall is 1.004 times it at p50 (1.086 at p90) | verified by replay |
| 4 | The gain on cezar | The part of a named wait that the tier causes falls from 9,406 s to 4,508 s in total (p50 96 s to 18 s), and an edit's wait from 39,064 s to 6,893 s (p90 520 s to 20 s). The rule cuts 169 files and throws away 4,454 file-seconds. Cancelling every time throws away up to 81,796 file-seconds. The #69 report: the first named verdict 22 s after the wait, against 332 s | verified by replay (model) |

## 1. The seam, and what a cancel costs

**Where a tier stops today** (*read in source code* at 70a0fe00):
- `src/core/scheduler/tiers.ts` `selectTier`: `cancellable = backlog || (turnTier && slot !== null)`, so an edit's tier, the turn's tier and a slow tier get `cancel: null` (`Tier.cancel`, "`null` for an edit's tier").
- `src/core/scheduler/scheduler.ts` `#pass` calls `#cancelBacklogs(applied.revision)` before the runner part, and `applied: () => this.#cancelBacklogs(null)` after it. `#cancelBacklogs` skips every tier without `tier.cancel`. `promote()` cancels nothing.
- `src/core/scheduler/backlog.ts` `cancelsBacklog`: an edit's work queued in the lane, or "an input of the tier" in the revision's changes. The second test is the supersession test case (b) needs; it is applied only to backlog tiers.
- `src/core/scheduler/store-decision.ts`: `cancelled` holds only when `tier.cancel?.signal.aborted`; unfinished files then `requeue`. `recordTier` re-queues them with `recent` `false` and keeps `catchUp`, so an edit's tier cut this way would lose its first-group place: the slice must keep `recent` and the promotion.
- The 001-179 split (`timeoutCap`, `requeueSplit`) applies to any fast tier of 2 or more files, edit tiers included, but only at `runner.timeoutMs`. In the window, 75 fast Vitest tiers timed out at 600 s, each holding the lane for the full 600 s.
- `src/runners/vitest/gate.ts` with `adapter.ts`: runs and the runner part are two lanes that overlap, but a recreate (`hold.exclusive`) waits until no call is inside either lane. `invalidate` recreates when a revision touches a config file or a file in a `globalSetup`'s closure (`recreateTriggers`, `src/runners/vitest/project.ts`). That is #69's "revision 5 not listed yet, because the runner part waits for the run in flight". Revision 5 of worktree 7c144ff7 changed `packages/web/e2e/agent-browser.ts`, which the e2e project's `globalSetup` `workspace-registry.ts` imports, while 47a09391 (four parity files, 366.6 s) ran. The revision's runner part waited until 07:08:32, and the named file ran at 07:09:13 (`results/timeline-7c144ff7.txt`). The server files were not re-keyed, so a supersession rule alone would not have helped. *verified from the store, read in source code.*

**What Vitest's cancel does to a file in flight** (*read in source code*, Vitest 4.1.10 as installed in cezar): `Pool.cancel` rejects the queued tasks ("Cancelled", so their files never start); `@vitest/runner` `startTests` aborts each running test's signal and calls `markPendingTasksAsSkipped`. So a cancel cuts the files in flight mid-file. Squeal counts only modules that ended before the cancel (`afterCancel`, `run.ts`). There is no "let the running files end and start no more" call. A split at a file boundary would need the tier run as several `run` calls. For an edit's tier of at most 4 files, every file starts at once: wall over the longest module is p50 1.05, p90 1.32 over 620 cezar runs (`results/calibrate.txt`). So a drain equals leaving the tier. `streaming-lanes.md` found the same for node:test (a drain current after 58.6 s, no better than today).

**Cost on real child processes** (*verified from the store*, `cancels.mjs`): 44 cezar runs report the scheduler's cancel, all of them backlog or catch-up tiers, at a recorded load of p50 52.5 (p10 24, p90 66). From the last revision during the run to the run's end: p10 1.2 s, p50 3.1 s, p90 8.9 s (41 runs). The p90 is above the 1 s plus 5 s grace, because the time includes the post-run checks and the record. One run (ca4682e8, 27 files) ended "workers did not stop" after 9.8 s, and its instance was dropped. One outlier (5338e278, 377 s) had no revision near its end, so the cancel came from a later event (*inferred*). Earlier live evidence: an edit was current 0.36 s after a backlog cancel at load 4.27 (`backlog-wall-budget.md`, finding 3). The work a cancel throws away is the elapsed time of each cut file, measured in finding 4.

## 2. The rule

| Case | Today | Rule | Why |
|---|---|---|---|
| (b) a revision re-keys every unfinished file of the running tier | an edit's tier runs to its end, then all its files run again (issue-63 case A) | **cancel, always** | Their results are discarded at record (`supersededIn`, the stability check). The cancel loses nothing valid, so no bound is needed. 93 of 134 superseding events were this case |
| (b') it re-keys some unfinished files | as above | yield, as (a) | the others' work is valid |
| (a) an edit's work queued in the lane behind a tier that is not the backlog's | waits for the tier (the backlog's own tier is cancelled today) | **yield** when the estimated remainder is over 30 s | gain against the lost work, finding 4 |
| (c) a promoted file queued behind any running tier | waits (C15) | **yield**, as (a) | same |
| (c') the runner part waits for the run to recreate the instance, with an edit's or a promoted file queued | waits, "not listed yet" | **yield**, as (a) | the recreate proceeds after the cancel |
| the backlog's turn after four first-group tiers | never cancelled | only (b) | keeps the backlog moving one tier in five |

**Estimated remainder:** the largest last-known duration among the tier's unfinished files, minus the time the tier has run. Unknown durations count 0, as in the backlog budget, so a tier of new files does not yield. **Fairness bound:** a yield marks the files it cuts, and a tier that holds a marked file at the same key does not yield (only (b) still cancels it). The mark ends when the file's result at that key lands or its key moves. So each file and key is cut by a yield at most once, and costs at most one partial run more. Without the bound the cuts repeat: in today's timeline, 405 files had two runs in a row each hit by an event, 22 had three, 12 had four or more (`fairness` line). In the replay at 30 s, the bound refused 14 yields.

**What finished files keep:** the cancel goes through the same `recordTier` as a backlog cancel. A file whose module ended before the cancel is stored if its inputs held still for the whole tier (the post-run re-stat, the tier's revisions, the run-end read and touch checks). A finished file whose input the revision changed is discarded, as it would be at the tier's end. The rest go back to the queue uncounted, at their D5 priority, still recent, forced, catch-up or promoted. Claims: a cut file releases its `running` phase, so another worktree that waited on the claim may now run the key itself, as after a backlog cancel today (*read in source code*; not measured).

## 3. How often

From `mid-tier.mjs` on the copy. A revision "reaches" a file when one of its paths is in the file's closure (today's closures, so older revisions are approximate, *inferred*), or when it changes a config or `globalSetup` file (`recreate`). A named-wait episode is one worktree, one blocking tier and its named files that were pending (the file ran after the tier, with no revision between the wait and its run that re-keyed it). Tier wall: p50 9.1 s, p90 230 s. The 489 tiers over 60 s took 125,114 of the lane's 140,079 s.

| Event during a fast Vitest tier | Count | Cancelled today | Wait for the tier, the others (p50 / p90 / max) |
|---|---|---|---|
| a revision reaching a fast file, or recreating | 233 (125 tiers) | 37 | 126 / 542 / 600 s |
| (b) supersedes a file of the tier | 134 | 22 | 122 / 563 / 600 s |
| of which every unfinished file | 93 | 7 | 122 / 563 / 597 s |
| (a) reaches only other files | 90 | 11 | 126 / 505 / 600 s |
| (c') recreates the instance | 21 (20 merges or pulls) | 8 | 148 / 520 / 526 s |
| named waits on a fast file | 706, of which 200 during a tier | none (C15) | |
| (c) episodes behind a tier | 66 (96 waits) | none | 96 / 359 / 564 s |
| of which a named file had failed | 32 (53 waits) | none | 113 / 470 / 559 s |

The two #69 reports are among them: 7c144ff7 at 07:04:19Z (`automations-api.test.ts`, 254 s behind 47a09391) and 12bfdcf5 at 07:12:46Z (284 s behind 34a80467) and 07:33:39Z (243 s behind 13b7282e). The issue-63 incident is not in the retained store. No run of `workflows/waits.test.ts` near 2026-10-20T22:56Z was found.

**gh-62 against the run logs** (*verified from the store*, `calibrate.mjs`, `gh62.mjs`). The scheduler's duration is the sum over a file's checks, the file-level row included (`durationOf`, `records.ts`), and that sum equals Vitest's module duration (ratio p50 and p90 1.000, 108 runs). A single-file run's wall over it: p10 1.001, p50 1.004, p90 1.086 (fixed cost p50 0.48 s, 123 runs). The file-level row alone is p50 0.5% of the file. gh-62's own file: row 3.5 s, checks 112.3 s, module 112.3 s, wall 113.0 s. So the 3.5 s that gh-62 reports is the file-level row that `why` shows. The duration the scheduler and this replay use is not biased by gh-62. The bias that remains is start delays inside multi-file tiers (finding 1: wall over the longest file p90 1.32). It overstates the files a cancel keeps and the work it throws away, by up to about 30% at p90.

## 4. The gain on cezar

The model: a cancel ends the tier 3.1 s after the event (p50 above). A named file then runs next, taking its own recorded duration plus its run's fixed cost. A cut file throws away the time it ran. Every file of a tier of up to 4 files starts with the tier. Cascades are not modelled: the reruns of cut files delay later work, and a later event may meet a different tier.

| Rule | Edit's wait for the tier (p50 / p90; total) | Named wait for the tier (p50 / p90; total) | Files cut | File-seconds thrown away |
|---|---|---|---|---|
| leave (today) | 64 / 520 s; 39,064 s | 96 / 359 s; 9,406 s | 0 | 0 |
| cancel at every event | 3 / 3 s; 669 s | 3 / 3 s | up to 1,572 | up to 81,796 |
| supersession only (b) | p90 395 s; 21,232 s | as today | 46 tiers' unfinished files | 0 |
| **(b), plus a yield over 30 s, one cut per file and key** | **3 / 20 s; 6,893 s** | **18 / 256 s; 4,508 s** | **169** | **4,454** |
| same, a yield over 60 s | 3 / 31 s; 7,074 s | 27 / 184 s; 4,417 s | 154 | 3,771 |
| same at 30 s, an unknown or overdue duration counted long | 3 / 4 s; 4,180 s | 3 / 184 s; 3,717 s | 623 | 6,615 |

The 30 s and 60 s rows are close. A higher threshold saves lost work but lets more waits run long. Counting overdue tiers as long helps most at load, where files run past their last duration (10 of the 19 named episodes the 30 s rule left waiting). It throws away 49% more work.

**The named file's verdict** (66 episodes, from the first wait): today p50 467 s, p90 1,400 s. Cancelling at the wait gives p50 62 s, p90 524 s. For the 32 episodes on a failed file: 375 s against 14 s at p50. Most of the rest of today's wait is not the blocking tier. The next tier started p50 1.2 s after the blocking tier ended and was the named file's in 47 of 66 episodes. But the named file's own tier then took p50 184 s, p90 604 s: cezar's parity files run 200 to 600 s, and a tier stores at its end (001-184). The rule does not change that. For the #69 report, the model gives a verdict 21.6 s after the 07:04:19Z wait (332 s today), for 4 cut files and 451 file-seconds. For 12bfdcf5 at 07:12:46Z, 74.6 s (892 s today), for 4 files and 676 file-seconds.

## Recommendation for Squeal

Make a running fast tier cancellable whatever its kind. Cancel it when a revision re-keys every file of it that has not ended. Otherwise cancel it only when an edit's work or a promoted file waits in its lane and the tier's estimated remainder is over 30 s. Each file and key may be cut that way once. The deciding tradeoff: on cezar's 6.5 days, the rule removes 82% of the time edits waited for a tier and 52% of the time named waits did, for 4,454 file-seconds of rework. Cancelling every time removes a little more and throws away up to 18 times as much. Supersession alone is free but leaves #69 as it is, because a recreate or a named wait re-keys nothing in the running tier. Split is not a separate option in Vitest (finding 1). node:test and pytest backlogs already start an edit beside their slots (011-21). Their edit tiers are out of this evidence.

**C4 sentences it would change** (step 5 and the 2026-10-18 amendment):
- "A tier with any work an edit caused in the queue, including the backlog's turn after four tiers of the first group, is never cancelled by a new revision." becomes: "Any fast tier in flight in a lane whose runner cancels (Vitest) is cancelled by a revision that changes an input of every file of it whose module has not ended, since their results would be discarded. Any other tier but the backlog's turn yields, once per file and key, while work an edit caused or a promoted file (C15) is queued in its lane, or the lane's runner part waits for the run: it is cancelled when the largest last-known duration among its unfinished files, less the time it has run, exceeds 30 s. A file that a yield cut is marked until its result lands or its key moves, and a tier holding a marked file does not yield (row 001-381, `research/running-tier-yields.md`: cezar, 2026-10-14 to 10-21, 233 revisions and 66 named-wait episodes during a tier; the edit's wait fell from 39,064 s to 6,893 s, the named wait's from 9,406 s to 4,508 s, for 4,454 file-seconds re-run)."
- "the files whose module ended before the cancel keep their results under the stability check below, the rest go back to the queue uncounted, still forced when `run --all --force` queued them" gains: ", still work an edit caused, catch-up or promoted when they were".
- "and a running tier is not interrupted (row 001-381 owns that)" becomes: "and a running tier yields as step 5 says".

**C15 sentences it would change:**
- Rank: "A running tier, whether an edit's or the backlog's, is never cancelled or split for promotion: that question belongs to 001-381." becomes: "A promoted file queued behind a running tier makes it yield as C4 step 5 says: once per file and key, when its estimated remainder exceeds 30 s, never the backlog's turn. Otherwise it waits for the tier."
- The wait's reasons: "behind the `<lane>` tier running since HH:MM:SS" gains "; the tier yields" when it will, or the reason it does not (its remainder, a file already cut, the backlog's turn). The 2026-10-20 amendment's "a claim or a running tier is waited for and nothing runs it sooner" keeps "a claim". A running tier is waited for only when it does not yield.
- "revision N not listed yet, because the runner part waits for the run in flight" gains: "; the run yields when a selected file is promoted".

## The question the human must decide

Which rule the slice ships: (A) supersession only (free, fixes the repeated runs of issue-63 case A, not #69); (B) A plus the yield over 30 s, one cut per file and key (recommended); (C) B with an unknown or overdue duration counted long (best waits, 49% more rework). Then the threshold, if B or C: 30 s or 60 s. Whether a named wait may cut the same agent's own work is part of the same choice. On cezar the blocking tier was always the same worktree's, which has one agent, and 47 of the 66 were tiers of at most 4 files, an edit's size.

## The slice's done-when, as tests

`test/scheduler/`, fake runner with fixed durations unless named:
1. Supersession: an edit's tier of 4 files (100 s known, 3 s real) in flight. A revision re-keys all 4. The tier is cancelled, each file runs once at the new key, and a promoted file is current before them. Red on main: 8 file runs (issue-63 probe case A).
2. Partial supersession: the revision re-keys 1 of 4, remainder over 30 s. The tier yields, finished files keep their results, and the 3 cut files are queued again as an edit's work and run after the edit's file.
3. A named wait: a tier of 4 files (200 s known) in flight and a promoted failing file queued. The tier yields, and the file is current within its run plus the cancel. Red on main: current after the tier.
4. A remainder of 30 s or less, or unknown durations: no yield, and the named file leads the next tier.
5. Fairness: a second edit and a second promotion during the cut files' rerun do not cancel it. Each file runs at most twice at its key, and a third save that re-keys every unfinished file still cancels.
6. The backlog's turn after four first-group tiers yields to nothing but supersession.
7. A recreate: a revision changes a `globalSetup` import while a tier runs and a promoted file waits. The tier yields, and the revision is listed before the tier would have ended (real Vitest adapter, a test file held mid-run, as `lanes.test.ts`).
8. The wait's text says the tier yields, or why it does not. `--json` carries the same reason.
9. Real Vitest with child processes: after the cancel, no process of the cut run is left (the sweep), and the cut files run again and store. Live, below load 8.
10. Cezar replayed with `probes/running-tier-yields/mid-tier.mjs` on the slice's rule, then live once the load is below 8. Version bump, review PASS.

## Open questions

- **Live numbers.** None was taken: load 26 to 44 here, and p50 41 to 53 at the replayed events. The cancel cost at low load is known only from the earlier 0.36 s.
- **Cascades.** The replay does not move later events after a cut. Their reruns delay other work by the 4,454 file-seconds, spread over the 6.5 days.
- **node:test and pytest edit tiers** are not cancellable. How often an edit or a named wait waits behind one was not measured, because this replay covered the fast Vitest lane only.
- **Claims after a cut.** Whether another worktree's waiter then runs the same key twice was not measured.
- **The named file's own tier** (p50 184 s) is the larger part of a named wait on cezar. It belongs to the tier-sharing rule (001-184) or to per-file storing, not to this row.
- **The issue-63 incident** is not in the retained store, so its case (A or B) stays not determined.

## Sources

- Squeal at 70a0fe00: `src/core/scheduler/{scheduler,tiers,backlog,store-decision,timeout-split,records,files}.ts`, `src/runners/vitest/{gate,adapter,run,reporter,project}.ts`.
- Vitest 4.1.10 as installed in cezar: `node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js` (`Pool.cancel`, `cancelCurrentRun`, `cancelTask`), `node_modules/.pnpm/@vitest+runner@4.1.10/.../dist/chunk-artifact.js` (`startTests`, `markPendingTasksAsSkipped`).
- Cezar: `.git/squeal/store.sqlite` (copied read-only 2026-10-21T08:12Z), `.git/squeal/runs/*/report.json`, `squeal.config.json` (`tierSize` 4, `timeoutMs` 600,000), `vitest.config.ts`, `packages/web/e2e/{vitest.config,workspace-registry}.ts`.
- Transcripts, read only: `~/.claude/projects/-home-agent-projects-cezar*/*.jsonl`, `~/.codex/sessions/2026/10/*/*.jsonl` (1,588 status waits, 828 naming a test path).
- Load: `/var/log/sysstat/sa14` to `sa21`.
- Spec 011 C4, C15; board rows 001-381, gh-63, gh-51, 011-17, 011-21, 011-24; `research/{issue-63,issue-51,catch-up,streaming-lanes,backlog-wall-budget}.md`; 013 `research/issue-62.md`; issues [#69](https://github.com/hearsay-tools/squeal/issues/69), [#63](https://github.com/hearsay-tools/squeal/issues/63).
- Probe: `probes/running-tier-yields/` (README, scripts, `results/`).
