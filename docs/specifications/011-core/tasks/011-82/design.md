# 011-82: a burst of revisions does not restart large batches, a design for the human

Board row 011-82, a docs-only design draft (brief `tasks/011-82/brief.md`; the human, 2026-10-21, from the host-load review, `research/host-load.md` 4). Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in section 6 go into 011 C4 step 5, C4's checkpoint paragraph and C6, and one sentence into 013 V7 for the 013 coordinator. `status.md` gets a dated line, and the board numbers the code rows of section 7.

Sources: the board row; `research/host-load.md` 4; 011 C4 and `status.md` through 2026-10-21; `research/backlog-wall-budget.md`, `research/catch-up.md`; the source at `90e442f7f` (main, 0.1.245) and, for worktree `716a6766`, at `94607f2e3` (0.1.240); Vitest 5.0.3's `BaseSequencer` and `VitestSpecifications` from an installed copy. Evidence: the squeal and cezar stores (`/home/agent/projects/{squeal,cezar}/.git/squeal/store.sqlite`) and their run logs, read only, for the 24 hours to 2026-10-21T20:46Z, at a one-minute load of 49 to 52 on 24 CPUs (`probes/`, `probes/results/`). No clone, no daemon and no test ran: every question was answered from the stores, the logs and the source. The load stayed between 41 and 63 during the work.

Brief defects. The backlog cancel is no longer at `tiers.ts:96`: since row 011-51 it is `cancelsBacklog` (`src/core/scheduler/backlog.ts:26`), called from `TierYields` (`yields.ts:101-104`); `tiers.ts:96` is now the `Tier.cancel` field. `claims.ts` has `Claims.backlogSize` (`:73`), which reads the policy key `runner.backlogTierSize`. Worktree `716a6766` was removed after the review, and prune dropped its runs, results, revisions and run logs (`src/core/store/prune.ts`: "everything owned by removed worktrees"); its only record is the coordinator's listing, copied to `probes/results/716a6766.txt`.

Evidence tags follow `docs/process.md`: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`; here also `verified from the store` and `verified from run logs`.

## Summary

- **A cancelled backlog tier loses mostly files that never started.** On squeal, 95 large tiers an edit or a revision cancelled picked 9,078 files and stored 870. 7,617 never ended, and at least 5,627 of those never started. On cezar, 63 such tiers picked 4,370 and stored 715. These tiers are 38% and 19% of all picks, and 87% and 66% of the picks that stored no result. They are only 7.4% and 1.3% of all run time. So the review's "40% and 24% of picked files stored no result" counts mostly free work: a file that never started costs a selection, not CPU.
- **Why: the backlog restarts into a burst.** Cancelled tiers started a median of 4 s (squeal) and 31 s (cezar) after the last revision. Tiers that finished started 188 s and 308 s after one. A cancelled tier ran a median of 11 s and 25 s before the next revision cancelled it.
- **A cancelled tier already keeps its finished files** (C4 step 5, 001-124). Today it drops ended files for two reasons: the stability check, which is right, and the Vitest adapter's whole-run withhold, which is wrong in one case (next bullet).
- **The 167 s batch of `716a6766`.** Its rows and log are gone, so the cause cannot be confirmed. The likely cause, `inferred` from source code and the same failure text in 6 live runs: revisions 29 to 32 wrote `test/e2e/codex-upgrade.test.ts` four times during the batch. Squeal excludes `test/e2e/**`, but Vitest's include matches it. Each revision's related walk loaded it into the run's instance. The next write made it a file "loaded during the run" whose bytes moved, which no file of the batch imports. So the adapter withheld every finished file (task 001-146's fallback). Revision 33 then cancelled the batch.
- **Recommendation, row A: a quiet wait after a cancel.** After an edit's work or a revision cancels a lane's backlog tier, the lane starts no backlog tier until 20 s pass with no revision that queues one of its test files. `squeal run --all` ends the wait. Over the 24 hours this would have kept 67 of 95 (squeal) and 16 of 63 (cezar) cancelled tiers from starting. It would have delayed 21 and 8 finished tiers by 313 s and 89 s in all. It adds nothing to an edited file's verdict and removes the cancel's wait (median 1.4 s and 4.6 s) from edits that come while the lane waits.
- **Recommendation, row B: the related walk reads only the files Squeal lists** (013 V7). Then an excluded test file is never loaded into a run, and its edits withhold nothing.
- **Rejected:** cancel only when the edit reaches the tier (the edit would wait a modelled median of 56 s and 107 s, against about 6 s today); a tier that grows with the quiet; Squeal's order inside a tier (about 64 and 127 more stored files a day, for 4 to 6% more backlog time). Section 2.
- **Measure:** the share of picks that store a result is 60.3% (squeal) and 76.1% (cezar) today, and about 81% and 78% expected with row A. Most of cezar's remaining loss is the slow lane, outside this row. Section 3.

## Decisions for the human

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | When does a lane wait for quiet before its next backlog tier? | (a) After its backlog tier is cancelled by an edit's work or a revision (`backlog` or `supersession` cause), until no revision queued one of its test files for 20 s. (b) After any revision that queues an edit's work in the lane, cancel or not. (c) Never, as today. | (a). It changes nothing outside a burst: a single edit, a pull's catch-up, a start and `run --all` behave as today. It gets most of (b)'s gain on squeal (6,148 of 7,747 avoided lost picks) and half on cezar (696 of 1,246), at 61% and 48% of (b)'s delay. (b) also delays the first backlog tier after every lone edit. Section 2.3. |
| Q2 | How long is the quiet? | (a) 10 s. (b) 20 s. (c) 30 s. | (b). After a cancel, squeal's tiers started a median of 3 s (p75 6 s) after a revision and cezar's 16 s (p75 48 s). 20 s is where both curves flatten: 10 s holds 63 and 9 tiers, 20 s 67 and 16, 30 s 68 and 17, at a delay of 118, 313 and 527 s a day (squeal). Section 2.3. |
| Q3 | Does `squeal run --all` end the wait? | (a) Yes: the caller asked for the backlog, so its tier starts at the next boundary; a later cancel starts a new wait. (b) No. | (a). An agent that runs `squeal run --all --wait` after its last edit would otherwise wait up to 20 s more. `status --wait` with no path waits for the edits' work (C6), which the quiet wait never delays, so it needs no rule. |
| Q4 | Does status name the wait? | (a) Yes: `Outstanding:` names the files the wait keeps queued, when it ends and `squeal run --all` as the command that ends it; `--json` gains the end time additively. (b) No. | (a). A backlog that does not run with nothing said reads as a stuck daemon. C15 already asks every group to name the command that advances it. |
| Q5 | Does the related walk stop reading files Squeal excludes (013 V7, row B)? | (a) Yes, now. (b) Later, with the broader question of the adapter's whole-run fallback (section 9). | (a). It is the cause of 114 of the 129 files the adapter withheld on squeal in the 24 hours, and the likely cause of the 167 s batch. It is small, and its files are disjoint from row A's. |
| Q6 | Does Squeal set Vitest's order inside a tier? | (a) No, keep Vitest's order. (b) Yes, a sequencer that keeps the pick order. | (a). Vitest runs a tier longest first when its results cache holds the files, so a cancel keeps the long files. But that hit 25 of 95 and 13 of 63 cancelled tiers. Run at the in-order tiers' rate, they would have stored about 64 and 127 more files a day. The model puts the cost at 5.7% and 3.8% more backlog time in tiers that finish. Section 2.5. |

## 1. Where the work goes (brief question 1)

### 1.1 What a cancel does today

*Read in source code.* A backlog tier in flight is cancelled by a revision whose re-key queues an edit's work in its lane, or that changes an input of the tier (`cancelsBacklog`). It is also cancelled by a revision that re-keys every file of it that has not ended (`superseded`, `yields.ts:155`). Vitest's `cancelCurrentRun` is forced after 1 s, and the instance is dropped 5 s later when its workers do not stop (`src/runners/vitest/run.ts`). For each file, `storeDecision` (`store-decision.ts:142`) does one of three things:

- **The module ended before the cancel.** The file keeps its result under the stability check and the completion barrier. A file whose inputs moved during the run is discarded and queued again, counted (`unstable`). A file the adapter withheld is discarded and queued again, counted toward three discards in a row, at which it is `unknown` (`withheld`).
- **Not ended.** The file goes back to the queue uncounted, in its class (`requeue`).
- **A newer run has the file at another key.** The outcome is dropped (`superseded`).

So "keep a cancelled tier's finished files whose key still holds", the brief's first option, is the rule since 001-124.

### 1.2 The numbers

Large tiers (13 or more files, more than cezar's `runner.tierSize` of 12) cancelled by an edit or a revision, stops excluded, 24 hours to 2026-10-21T20:46Z (`probes/tiers.mjs`, `order.mjs`; `results/*.txt`). *Verified from the store and run logs*, except where tagged.

| | squeal | cezar |
| --- | --- | --- |
| Tiers | 95 | 63 |
| Files picked | 9,078 | 4,370 |
| Stored a result | 870 (9.6%) | 715 (16.4%) |
| Ended, withheld by the adapter | 124 | 29 |
| Ended, no result row: a stability discard, or a later run at the same key replaced the row | 467 | 432 |
| Never ended | 7,617 | 3,194 |
| of which running at the cancel, at most (*inferred*, one file per worker) | 394 at the fitted widths of 3 to 10; 1,990 at 23 workers | 168 at 2 to 9; 1,230 at 23 |
| so never started, at least (*inferred*) | 5,627 (7,223 at the fitted widths) | 1,964 (3,026) |
| Not stored, at the same key after the run's revisions (today's closures, *approximate*) | 4,628 (56%) | 2,626 (72%) |
| Not stored, re-keyed by a revision during the run | 3,580 | 1,029 |
| Run time of these tiers | 2,262 s: 7.4% of all runs, 13.1% of large tiers | 3,036 s: 1.3% of all runs, 12.4% of large tiers |
| Share of all picks; of the picks with no result | 38%; 87% | 19%; 66% |
| Tiers no revision during them reached (no file re-keyed) | 18 (2,176 picks, 481 stored) | 22 (1,162 picks, 192 stored) |
| Tiers whose every file was re-keyed | 32 | 1 |

For comparison, large tiers that finished stored 93.4% (squeal, 117 tiers) and 91.6% (cezar, 174) of their picks. Small runs stored 95.8% and 87.7%.

### 1.3 Why they never start: the backlog restarts into a burst

| | squeal | cezar |
| --- | --- | --- |
| Cancelled tiers: s from the last revision to the start, p25 / p50 / p75 | 2 / 4 / 6 | 13 / 31 / 179 |
| the same, tiers whose previous large tier was cancelled too | 2 / 3 / 6 | 8 / 16 / 48 |
| Finished tiers | 9 / 188 / 709 | 54 / 308 / 987 |
| Cancelled tiers whose next revision is stored before their end (95; 52): s from the start to it, p50 / p90 | 11.3 / 40 | 25.3 / 95.7 |
| From that revision to the tier's end (the edit's wait for the cancel), p50 / p90 | 1.4 / 3.2 | 4.6 / 7.8 |

*Verified from the store* (`gaps.mjs`). In 11 cezar tiers the revision that cancelled them is stored after the run's end. A backlog tier starts right after the edit's tier, the next edit comes seconds later, and the cycle repeats. `716a6766` ran 23 batches of 200 that way between 17:52 and 18:09Z. 21 of them started 2 to 27 s after a revision (`results/716a6766-burst.txt`).

### 1.4 Vitest's order inside a tier

*Read in source code:* Vitest's `BaseSequencer.sort` runs files without a cached result first (larger files first), then failed files, then the longest first by its results cache. Squeal's instance keeps that cache (`research/backlog-wall-budget.md` 2). *Verified from run logs* (`endorder.mjs`): in three finished 200-file squeal tiers, the first modules to end were the last picked (pick positions 188, 176, 178 …) and the shortest picked ended last. Among the cancelled tiers, squeal's ended in reverse in 25 and in order in 36, with 34 mixed. Cezar's: 13, 33 and 17 (`reversed.mjs`). A tier runs in order when Vitest's cache lacks its files, as in a new worktree. In-order cancelled tiers stored 13.5% and 23% of their picks; reversed ones stored 10.7% and 7.5%. So C4 step 4's "shortest first" holds between tiers, and Vitest reverses it inside a tier once its cache is warm.

### 1.5 The 167 s batch at revision 28 of `716a6766`

Its run row, results and `vitest.log` were deleted with the worktree, so **it cannot be confirmed**. What survives (`results/716a6766.txt`, Squeal 0.1.240): the batch started at 18:04:51Z, 117 s after revision 28. Its predecessor at revision 28 ran 111 s and stored all 200 files. Revisions 29 (18:05:25, `test/e2e/codex-upgrade.test.ts`, a new file: it was never committed), 30, 31 and 32 (18:06:07) wrote only that file. Revision 33 (18:07:35) edited `test/harness/codex/version-copies-tier.test.ts`, the batch ended about 3 s later with nothing stored, and a one-file edit tier ran at 18:07:37.

The likely cause, *inferred* and *read in source code* at 0.1.240 and 0.1.245:

1. `squeal.config.json` excludes `test/e2e/**`, but `vitest.config.ts` includes `test/**/*.test.ts`. An excluded file queues no edit's work and is in no file's closure, so revisions 29 to 32 did not cancel the batch. Only `test/version-sensitive.test.ts` observes `test/e2e/` today, as a listing.
2. Each of those revisions' runner part ran beside the batch (001-140) and called `affected`. `relatedSpecifications` (`src/runners/vitest/related.ts`) asks Vitest's `getRelevantTestSpecifications`, which globs every file Vitest includes and transforms each in the instance's `ssr` environment. That stamps the e2e file as read at or after the run's `loadedSince` (`SourceStamps`, `sources.ts`).
3. The next write moved those bytes. At the batch's end, `invalidateStale` named the file stale. `mayHaveRun` (`moved.ts:23`) found no file of the batch that imports it and, as task 001-146's fallback for a computed `import()` says, tainted every file of the run. `withoutFiles` withheld every finished file.
4. Revision 33 queued an edit's work and cancelled the batch. The files not ended went back uncounted, and the withheld ones were discarded, each counted toward its three-discard limit.

The same signature is in the live squeal store: 6 runs in the 24 hours withheld every finished file, 114 of the 129 files because `test/e2e/zz-cost-print.test.ts` or `test/e2e/ps.test.ts` "changed on disk after this run loaded it (task 001-146)" (`withheld.mjs`). One was a 102-file tier of worktree `fd36f2ea` that ran 76 s and withheld 100. *Verified from run logs.* The other reading, that no module ended in 164 s, is unlikely: the batch was cut at 200 files by `runner.backlogTierSize`, not by the 120 s budget, and its predecessor ended all 200 in 111 s.

## 2. Options (brief question 2)

| Option | Gain on the 24 hours | An edited file's verdict | The backlog and checkpoints | Verdict |
| --- | --- | --- | --- | --- |
| Keep a cancelled tier's finished files whose key holds | none: it is the rule | unchanged | unchanged | today (2.1) |
| Cancel only when the edit reaches the tier | 18 and 22 tiers run on: at most 2,176 and 1,162 picks | waits the tier's remainder: modelled p50 56 s and 107 s, p90 223 s and 189 s | unchanged | rejected (2.2) |
| Quiet wait after a cancel, 20 s | 67 and 16 tiers not started: 6,148 and 696 lost picks, 1,620 s and 799 s of run time | unchanged; no cancel wait (p50 1.4 s and 4.6 s) when an edit finds the lane waiting | 21 and 8 finished tiers start later: 313 s and 89 s in all | recommended (2.3) |
| Quiet wait after any edit's work, 20 s | 88 and 23 tiers: 7,747 and 1,246 picks, 1,893 s and 1,081 s | as above | 39 and 21 tiers: 514 s and 186 s; the first backlog tier after every lone edit waits | Q1 (b) |
| A tier that grows with the quiet | for in-order tiers none; for reversed ones the same as the order fix | unchanged | more Vitest runs per burst | rejected (2.4) |
| Squeal's order inside a tier | about 64 and 127 stored files a day | unchanged | finished tiers 5.7% and 3.8% longer (modelled) | rejected, Q6 (2.5) |
| The related walk reads only listed files (row B) | 114 withheld files on squeal; none on cezar | unchanged | unchanged | recommended (2.6) |

Figures are squeal first, then cezar.

### 2.1 Keep finished files

It is C4 step 5 since 001-124. The ended files a cancelled tier dropped (591 and 461) were the stability check's discards of files a revision re-keyed, which is correct, and the adapter's withholds (124 and 29, 2.6). Some only seem dropped: a later run at the same key replaces the row, so the earlier run looks as if it stored nothing (host-load 4 says so; it also explains the 845 ended-without-a-row files in cezar's finished tiers). No C4 change.

### 2.2 Cancel only when the edit reaches the tier

In 18 (squeal) and 22 (cezar) cancelled tiers, no revision during them re-keyed a file of the tier, so letting them finish would have stored their files. The edit would wait for the tier instead. C4 bounds an edit's wait for a Vitest backlog tier by the cancel's grace, about 6 s (001-124; measured 0.36 s, `research/backlog-wall-budget.md`). These tiers had run a median of 18 s and 31 s and had a modelled remainder of 56 s and 107 s (p90 223 s and 189 s, `order.mjs` at fitted widths, which run low, so the remainder runs high). Under load the estimate fails: worktree `a2246096`'s 196-file tier had ended 25 files after 124 s. Running the edit beside it needs a second Vitest instance per daemon, which costs memory (011-84) and CPU. *Rejected*: it moves the cost onto the edited file's verdict, against the human's performance-first rule.

### 2.3 A quiet wait (recommended)

*Verified from the store* (`gaps.mjs`), with one simplification: a tier the wait holds counts as never started in its gap. In a gap longer than the quiet it would start later and could still be cancelled, so the model overstates the gain there and understates the cost.

| Quiet | After a cancel: tiers held (squeal, cezar) | lost picks avoided | run time avoided | finished tiers delayed, delay in all | Any edit's work: tiers held | lost picks avoided | finished delayed, delay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 s | 63, 9 | 5,779, 353 | 1,500 s, 380 s | 17, 5; 118 s, 18 s | 79, 12 | 6,574, 422 | 29, 10; 177 s, 32 s |
| 20 s | 67, 16 | 6,148, 696 | 1,620 s, 799 s | 21, 8; 313 s, 89 s | 88, 23 | 7,747, 1,246 | 39, 21; 514 s, 186 s |
| 30 s | 68, 17 | 6,298, 711 | 1,647 s, 848 s | 22, 8; 527 s, 169 s | 89, 26 | 7,897, 1,446 | 40, 27; 908 s, 432 s |

On `716a6766`, 20 s after a cancel would have held 19 of its 23 batches: 3,800 picks and 473 s of batch time, with 545 stored files deferred to later batches.

What the wait leaves alone, *read in source code*. The edit's tiers and promoted files (C15) are the first group, so they start at once. The backlog's turn after four tiers of the first group is selected while an edit's work is queued and is never cancelled by an edit, so it keeps its one tier in five. A lane whose runner cannot cancel (node:test, pytest) runs its backlog in slots that an edit runs beside, so it never waits. A slow tier already waits for the fast backlog (004 D2 as amended, 004-60), and does so a little longer. A pull's catch-up revision queues no edit's work (10 or more keyed paths), and a daemon's start and `run --all` cancel nothing, so none of them starts a wait. The wait is the daemon's memory, like a timed-out file's tier cap: a restart forgets it.

Costs. No wait for an edited file's verdict. A `status --wait` with no path waits for the edits' work, not the backlog (C6), so it is not delayed. `run --all --wait` ends the wait (Q3). The backlog, the slow lane behind it and other worktrees that would adopt its results start up to 20 s later after a cancel: 313 s and 89 s in all over the 24 hours. During the wait the lane holds no pool permit, which leaves the permit to other daemons (011-83).

### 2.4 A tier that grows with the quiet

A tier capped by the time since the last revision helps only when Vitest runs it longest first: in an in-order tier, a cancel at any moment ends the same files, small or large. For reversed tiers, setting the order (2.5) is the direct fix, and both gains are small. Each growth step is one more Vitest run (workers, setup files) during the burst, which is the CPU this row is meant to save. *Rejected.*

### 2.5 Squeal's order inside a tier

A sequencer that keeps the pick order would make a cancel keep the shortest files. Vitest serialises `sequence.shuffle`, `concurrent`, `seed`, `hooks` and `setupFiles` but not `sequencer` (Vitest 5.0.3, `serializeConfig`), so it would not move a key (*read in source code*; a row would have to prove it). The gain is small: the 25 and 13 reversed tiers, at the in-order tiers' rate, store about 64 and 127 more files a day, and fewer once row A holds the backlog in bursts. The cost: in tiers that finish, the longest file starts last. Modelled at fitted widths, their makespan rises from 14,064 s to 14,863 s (squeal, +5.7%) and from 22,378 s to 23,229 s (cezar, +3.8%), still within the 120 s budget's estimate, which assumes any order. A project's own `sequence.sequencer` or `shuffle` would need a rule too. *Rejected for now* (Q6).

### 2.6 The related walk (row B)

`relatedSpecifications` should hand Vitest only the specifications Squeal lists: set `config.related` and call `vitest.specifications.filterTestsBySource(listed)` instead of `getRelevantTestSpecifications()`, which globs Vitest's whole include (Vitest 5.0.3: the second is `filterTestsBySource(globTestSpecifications())`). An excluded test file is then never transformed into the instance unless a listed file imports it, and then the run reaches it, as today. This is sound against 001-146: a run that loads such a file through a computed `import()` still stamps it during the run, and the fallback still taints every file. *Read in source code.*

Cezar's 107 withheld files (30 runs, 20 of them all withheld) have another cause: a source touched or moved during the run that no file of the run reaches (`packages/cezar/src/skills-provision.ts`, `workflows/run.ts`). Row B does not cover them. Section 9.

## 3. Measure (brief question 3)

The measure is the share of picked files that store a result, as host-load 4 counts it: distinct test files with a result row still naming the run, over all files of all runs (`tiers.mjs`). It counts a file whose row a later run at the same key replaced as no result, and a file that never started as a loss. So it overstates lost CPU. Row A's own measure is the run time of large tiers an edit cancelled.

| 24 hours to 2026-10-21T20:46Z | squeal | cezar |
| --- | --- | --- |
| Today: picks, stored, share | 23,845; 14,387; **60.3%** (host-load 4: 60%) | 23,247; 17,688; **76.1%** (76%) |
| Row A, 20 s after a cancel (Q1 (a)) | 81.3% | 78.4% |
| Row A, 10 s or 30 s after a cancel | 79.6%; 82.0% | 77.3%; 78.5% |
| Row A, 20 s after any edit's work (Q1 (b)) | 89.4% | 80.4% |
| Row B | at most +0.5 point, part of it inside row A's held tiers | none |
| Run time of large tiers an edit cancelled: today, expected with A at 20 s | 2,262 s; about 640 s | 3,036 s; about 2,240 s |

*Inferred*: expected = stored ÷ (picks − the lost picks the wait avoids). This assumes the files the wait defers are stored later, and the same edits on the same days. A rerun of `probes/run.sh` over the 24 hours after the release is the landing check.

What stays out of reach of this row, on cezar's 24 hours. Runs that stored nothing took 9.0 of 62.7 run-hours (host-load: 10.3 of 66.0). Large cancelled tiers were 0.16 h of that. The rest: 27 small runs that timed out (4.5 h, the slow e2e lane), 50 small runs that completed and stored nothing (2.2 h), 76 small cancelled runs (0.9 h) and 134 crashes (0.75 h). They are for the coordinator to triage, beside host-load 3.2, cezar's own declared inputs.

## 4. Keys and stored rows

- **Row A** changes which tier starts when, never what a run stores or accepts. `tiers.ts`'s selection, the queue, `yields.ts`, the scheduler and status are outside the global validity entries (`test/keys/validity/entries/global.ts` says so for "`tiers.ts`'s selection"). No key, adapter or format version moves. The alarm, `test/keys/key-format.test.ts`, must stay silent. *Read in source code.*
- **Row B** changes `src/runners/vitest/related.ts`, inside the Vitest adapter's validity entry (`entries/vitest.ts`: the adapter and what it imports). It changes which runs withhold files, so the alarm may fire. 011-37's rule raises the version only when a row an earlier release stored would be written or accepted differently. Rows 0.1.245 stored keep their meaning; row B stores rows 0.1.245 withheld for bytes the run never executed. The expectation is no raise of `VITEST_ADAPTER_VERSION`; the alarm and its cases decide. *Inferred.*
- **No schema change.** Row A's status row is one `meta` row per worktree, as `yields:<worktree>` is (011-51).

## 5. Seams shared with the other host-load designs

- **011-83 (the host cap).** Row A adds its check to `selectTier` (`tiers.ts`), the function that asks the pool for its offer and grant (`context.capacity.offer`, `take`). A change to how a backlog tier takes its grant lands in the same function: land one, rebase the other. A waiting lane holds no permit.
- **011-84 (departed and unused daemons).** A quiet wait is a queued backlog with no tier in flight. If 011-84 counts a queued backlog as use under `daemon.unusedExitMinutes`, a waiting lane is in use; the wait lasts 20 s, far below the minutes. A departure's drain of the fast backlog waits at most 20 s after the last edit, since nothing edits after a session has left. The idle collection (C9, 011-69) counts a waiting lane as idle. Row A does not touch `daemon.ts` or `lifecycle.ts`.
- **011-85 (keys).** Row B and 011-85's per-project config row both change the Vitest adapter (`related.ts` against `project.ts`), under one validity entry and one `VITEST_ADAPTER_VERSION`. If 011-85 raises it, row B rides that release with no decision of its own.

## 6. Spec text (drafts)

**C4 step 5**, after "…, still forced when `run --all --force` queued them, still work an edit caused, catch-up or promoted when they were, and the edit's tier runs next.":

> After such a cancel, the lane **waits for quiet**: it starts no backlog tier, catch-up included, until 20 s (`BACKLOG_QUIET_MS`) pass with no revision whose re-key queues a test file of that lane, so a burst of edits does not restart the backlog after each of them. The wait holds nothing else: the edit's tiers, a promoted file (C15), the backlog's turn after four tiers of the first group and the slow tier start as before. A lane whose runner cannot cancel, which runs its backlog in slots, never waits. `squeal run --all` ends the wait (below). The wait is the daemon's memory: a daemon that starts has none. Status names it (C6). (Amended 2026-10-2x, the human, row 011-82, `tasks/011-82/design.md`: on the squeal and cezar stores, 24 hours to 2026-10-21T20:46Z, the large backlog tiers an edit or a revision cancelled started a median of 4 s and 31 s after the last revision, against 188 s and 308 s for those that finished, picked 9,078 and 4,370 files and stored 870 and 715; at least 5,627 and 1,964 never started. The wait would have kept 67 of 95 and 16 of 63 from starting, and delayed 21 and 8 finished tiers by 313 s and 89 s in all.)

Under Q1 (b), its first sentence reads instead: "After a revision whose re-key queues an edit's work in a lane, that lane waits for quiet: …".

**C4, the checkpoint paragraph**, after "Explicit checkpoints: `squeal run --all` queues every test file whose key has no result, or every test file when `--force` is given.":

> It ends every lane's wait for quiet (step 5): its backlog starts at the next tier boundary, and a later cancel starts a new wait (row 011-82).

**C6**, in the `Outstanding:` description, after "one line per group of files not current with the command that advances it or that none does (C15), at most six groups;":

> files a lane's wait for quiet keeps queued (C4 step 5) are one group, which names when the wait ends and `squeal run --all` as the command that ends it, and `--json` gives the end as `quietUntil` (row 011-82);

**013 V7**, one sentence for the 013 coordinator: "The related walk transforms only the test files Squeal lists: a file `vitest.exclude` or `vitest.excludeProjects` leaves out is never loaded into the instance unless a listed file imports it, so its edits during a run withhold nothing (011-82 row B; task 001-146's fallback withheld every finished file of a run when an excluded test file the walk had loaded moved)."

## 7. Code rows

The two rows own disjoint files and can run side by side. Row A gives most of the gain.

**Row A: the quiet wait after a cancel (C4 step 5, the checkpoint paragraph and C6, as amended).**

- Seams. A new `src/core/scheduler/quiet.ts`: `BacklogQuiet`, per lane the time the wait ends, with `cancelled(lane, now)`, `queued(lane, now)` (a revision's re-key queued a file of the lane), `end()` (`run --all`) and `waits(lane, now)`, and `BACKLOG_QUIET_MS = 20_000`. `TierYields.check` (`yields.ts`) calls `cancelled` when it aborts a backlog tier for `backlog` or `supersession`. The revision's content re-key and runner part (`revision.ts`, `refinement.ts`) call `queued` for each lane they queue a file of. `selectTier` (`tiers.ts`) leaves a waiting lane's files queued when the tier would be the backlog's, as it does for a busy lane, and takes the first group and the turn as before. The pump (`scheduler.ts`, `#pump`) waits for the earliest wait's end as it waits for a claim (`#claimWake`). The checkpoint start (`run --all`) calls `end`. The scheduler publishes the ends in one `quiet:<worktree>` `meta` row with `yields:<worktree>`'s liveness rules, listed in `WORKTREE_META_ROWS`. `src/core/status/standing.ts` and the `Outstanding:` formatter read it.
- First edit, a lead: `selectTier` with a lane that `waits` and only second-group files queued, and a unit test that it returns `null` and starts nothing; then the same with an edit's file queued, which it takes.
- Owns: `src/core/scheduler/quiet.ts` (new), `tiers.ts` (`selectTier` only), `yields.ts`, `scheduler.ts` (the wake and `run --all`'s call), the queue calls in `revision.ts` and `refinement.ts`, `src/core/status/standing.ts` and the `Outstanding:` text, the `quiet` meta key beside `yieldsMetaKey`, an additive `quietUntil` in the status payload type, and their tests. Not yours: `store-decision.ts`, `stability.ts` and the other global validity modules, `src/runners/`, `src/core/capacity/`, `src/core/daemon/`, spec text, the board, bundles.
- Done when, tests first and red before, in `test/scheduler/backlog-quiet.test.ts` with a fake runner of fixed durations and the injected clock, unless named:
  1. **Waits.** A 50-file backlog tier cancelled by an edit of a test file outside it: the edit's tier runs at once, and no backlog tier starts until 20 s pass with no revision; then one starts. Red on main: it starts right after the edit's tier.
  2. **A burst.** An edit every 10 s for 60 s: each edit's tier runs at once, no backlog tier starts during the burst, and one starts 20 s after the last edit.
  3. **Only the lane's own revisions count.** A revision that queues nothing in the lane (a `docs/` edit, a node:test file in a mixed repository) does not extend the wait; one that queues a file of the lane does.
  4. **Not waiting.** No wait follows the first backlog tier of a `run --all`, a pull's catch-up revision of 12 keyed paths or a daemon start; a promoted file and the turn after four first-group tiers start during the wait; a node:test lane's slots never wait.
  5. **`run --all` ends it.** `squeal run --all` during a wait starts the backlog tier at the next boundary, and a later cancel starts a new wait.
  6. **No cancel wait.** With the lane waiting, an edit's tier starts in the same pump as its revision is refined: its result lands at least the cancel's grace sooner than with a backlog tier in flight (the fake runner's cancel takes 1 s).
  7. **Status.** During a wait, `squeal status` lists the files it keeps queued as one `Outstanding:` group with its end and `squeal run --all`; `--json` carries `quietUntil`; with no `quiet` row (an older daemon), the text is today's.
  8. **Real Vitest** (`test/scheduler/`, the real adapter, as `tier-sharing.test.ts` holds a file mid-run): a backlog tier cancelled by an edit, then a second edit 5 s later, starts no backlog run between them.
  9. `test/keys/key-format.test.ts` passes with no raise; existing `test/scheduler/` tests pass unchanged, or each change is named.
  10. **Landing check:** `probes/run.sh` over the 24 hours after the release, with the load: large tiers an edit cancelled, their picks and run time, and the share of picks that store a result, against section 3.

**Row B: the related walk reads only the files Squeal lists (013 V7 as amended).**

- Seams: `relatedSpecifications` (`src/runners/vitest/related.ts`) takes the listed specifications and calls `vitest.specifications.filterTestsBySource(listed)` with `config.related` set, under the same reset check. `affectedTestFiles` (`affected.ts:50`) passes its `specs`. The walk's fallback, `walkRelated`, already walks `specs`.
- Owns: `src/runners/vitest/related.ts`, `affected.ts`, their tests under `test/runners/vitest/`. Not yours: `moved.ts`, `sources.ts`, `touched.ts`, `project.ts` (011-85), `src/core/`.
- Done when, tests first and red before, with the real adapter and a fixture whose `squeal.config.json` excludes `e2e/**` while its Vitest include matches `e2e/x.test.ts`:
  1. **Red.** A tier of three quick files and one held for 3 s. During it, add `e2e/x.test.ts`, then change it twice, each followed by `affected` as a runner part makes it. The tier stores all four files and its report withholds none. Red on main: every finished file is withheld, and the failure names `e2e/x.test.ts` "changed on disk after this run loaded it (task 001-146)".
  2. After `affected` for a changed source, no module of `e2e/x.test.ts` is in the instance's module graph.
  3. The walk still finds every listed test file that imports the changed path, directly or not, and an excluded file that a listed file imports is still reached.
  4. The fallback still holds: a listed test file that loads a module through a computed `import()` during the run, whose bytes then move, still withholds every file of the run.
  5. `test/keys/key-format.test.ts`: if it fires, the row applies 011-37's rule (section 4) and says what it decided.

## 8. Rejected options

- **Cancel only when the edit reaches the tier** (2.2): the edit waits the tier's remainder, a modelled median of 56 s and 107 s against about 6 s today.
- **The 30 s remainder rule (001-381) for backlog tiers too:** it compares last-known durations, and under load a tier runs far slower than they say (`a2246096`: 25 of 196 files ended after 124 s). It would keep the edit waiting as above.
- **A tier that grows with the quiet** (2.4): nothing for in-order tiers, and more Vitest runs during the burst.
- **Squeal's order inside a tier** (2.5, Q6): small gain, longer finished tiers.
- **Let a cancelled tier's running files finish, starting no more:** Vitest's API cancels the whole run; the edit would wait for its longest running file.
- **An edit's Vitest tier beside the backlog's, in a second instance**, as node:test and pytest run edits beside their slots: one more instance per daemon, with its memory (011-84) and CPU, and the burst's backlog would still run into the edits.
- **A quiet wait for every lane, slots included:** an edit never waits for a slot (C4 step 5, 011-21), so nothing is lost there.
- **A setting for the quiet:** C10 adds no setting where one number fits both stores, as 011-69 chose.

## 9. Limits and open questions

- The 167 s batch's cause is inferred: its own log is gone. The mechanism is read in source code and its failure text appears in 6 live runs of 0.1.242 and 0.1.245.
- Nothing ran live. The quiet wait's numbers come from one 24-hour window of two stores, with a held tier counted as never started in its gap (2.3). Row A's landing check measures it.
- "Never started" is bounded, not counted: a run log names the modules that ended, not those that started. A `MODULE start` line in `vitest.log` would let the next measure count it; it is not proposed here.
- "Re-keyed" uses today's closures and observed sets, so a closure that has changed since the run is misjudged.
- The adapter's whole-run fallbacks (tasks 001-146 and 001-159) withhold every file of a run for a moved or touched source that no file of the run reaches. On cezar that was 20 runs and 107 files in the 24 hours, from sources the related walk loaded. A sound narrowing needs to know which modules the run's workers fetched, which the adapter does not track. A question for 013, outside this row.
- The slow lane's timeouts and crashes on cezar (section 3) dominate its runs that stored nothing. They are not 011-82's.
