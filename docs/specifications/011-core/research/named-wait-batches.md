# Row 011-267: a named wait as one wide batch

Recommendation: take the human's batch, with two changes. Run the edit's tier beside the batch, not after it. Give the backlog one tier after each batch tier. With those changes, the 56-file gate reaches its verdict in 327 to 364 s at 11 workers. The recorded traces took 1,978 and 2,053 s. An edit's own files then do not wait for the batch.

Researcher, row 011-267, 2026-10-29. Brief: `tasks/wave-59.md` R1. Worktree commit `bb063a9b7` (Squeal 0.1.377 source). Evidence: cezar's store, read-only, and the two agents' own session logs. Probes: `probes/011-267/` (README lists every command).

## Questions answered

All times are seconds from the first named wait. The model uses 11 workers, the agent's recorded waits, and each file's recorded duration.

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Each order on both traces | Verdict: recorded 1,978 / 2,053. Today's (0.1.377) rules in the model: 1,215 / 1,325. Human's batch: **364 / 327**. Edit's own files: recorded 519 / 190; batch **569 / 400** (later); batch with the edit's tier beside **318 / 283**. | verified by experiment (model); recorded times read in source data |
| 2 | Longest-first or shortest-first; one batch or per-file slots | Longest-first: 364 / 327. Shortest-first: 485 / 449 (+33%). Budget-sized tiers (row 011-265's sizing kept for the batch): 550 / 527. Slots give the same verdict (369 / 332), earlier per-file results, and the whole queue sooner (902 against 1,062). Vitest has no slot lane. | verified by experiment (model); Vitest order read in source code |
| 3 | An edit during the batch | Beside: a 2 s edit file is current in 3 s; the verdict does not move. Wait: 67 to 307 s. Cancel: 429 to 1,033 file-seconds lost and the verdict 45 to 143 s later. The batch follows the newest revision. | verified by experiment (model); revision rule inferred from C4 |
| 4 | A one-file wait behind a 55-file batch | Strict order: 38 to 338 s for a 2 s file. Today's rules: 136 to 313 s. A small later wait run beside: 3 s. | verified by experiment (model) |
| 5 | Streams, overlapping waits, re-waits | Re-waits form no new batch: the 16 recorded waits form 2 batches. Without a bound, a stream of heavy waits gives unnamed files their first result at 1,607 s. Today's rules give 916 s. One backlog tier after each batch tier gives 435 s, and the gate's verdict does not move. | verified by experiment (model) |
| 6 | Does this replace gh-125 and 011-266? | It replaces gh-125's scheduling half: the gate is faster than the foreground runs (490 and 631 s). It does not cover gh-125's handoff half. It does not replace 011-266. S3 becomes the batch's fairness rule. S2 is still a separate decision. | inferred from Q1 and Q5; foreground times read in the reports |

## Evidence

**What the traces show (read in source data).** cezar's store, table `runs`, with each run's `report.json`. The agents' session logs give every wait's start and selection.

- 0.1.377, worktree `aa38987337df8e1f`. First wait at 09:29:19 UTC; the verdict came at 10:02:17 (1,978 s). The agent ran 60 s waits. Between them it left gaps of 9 to 116 s (median 17 s). In those gaps promotion lapsed, so backlog tiers of 181, 32 and 14 files started at 09:38:19, 09:40:18 and 09:43:35. Waits ended at 09:49:19. The last three named files (184, 221 and 239 s) then ran in backlog tiers beside a 306 s file. A second wait named the agent's own five edit files at 09:33:46. Those files were current at 09:37:58.
- 0.1.374, worktree `fc6636c99e616927`, first gate. First wait at 01:21:55; the verdict came at 01:56:07 (2,053 s). This agent ran 60 s waits with 180 s timers between them, so promotion was open about 24% of the time. Every promoted tier had four files. The second gate, a rebase at 02:00, was not replayed.
- The named set is 56 files; `ui-parity` ran in neither window, so the replays use 55. Named work: 3,768 file-seconds in 0.1.377 (the board's figure) and 3,545 in 0.1.374.

**Wide tiers did not slow the named files (verified by experiment, `widths.mjs`).** Each file's 0.1.377 duration was divided by its 0.1.374 duration. Files that ran in tiers of 5 to 11 files: median 1.03 (28 files). Tiers of 12 or more files: median 0.99 (15 files). This answers part of `issue-79-gate.md`'s open question. The test is only up to the widths the trial ran. Inferred from wall time, those wide tiers ran at 5 to 11 workers (`width-inferred.mjs`). So the trial's grant was well below cezar's 23 slots.

**The model (verified by experiment).** `model.mjs` replays one Vitest lane with each file's recorded duration. It keeps tier size, tier sharing, the wall budget, the turn, promoted-only wide tiers and results at a tier's end. It leaves out yields, claims, quiet waits, class order inside the first group, and pool contention. Last-known durations match the recorded ones (median ratio 0.99 and 0.89, `lastknown.mjs`), so the model's knowledge of durations is not the error. The real error is the rules it leaves out. Today's rules in the model run 36 to 39% faster than the recorded traces. So the model's numbers for today are a lower bound. The batch candidates do not depend on the rules left out, but no real batch has been measured.

**Q1, Q2: the main replay** (`replay-output.txt`; 0.1.377 / 0.1.374):

| Order | 6 workers: verdict, own | 11 workers: verdict, own, all | 23 workers: verdict, own |
| --- | --- | --- | --- |
| Recorded trace | 1,978, 519 / 2,053, 190 | same | same |
| Today's rules (0.1.377) | 1,815, 769 / 1,567, 176 | 1,215, 666, 1,521 / 1,325, 176, 1,325 | 845, 1,050 / 799, 176 |
| Human's batch, longest-first | 651, 856 / 594, 667 | **364, 569**, 1,062 / **327, 400**, 1,105 | 257, 475 / 240, 313 |
| Batch, shortest-first | 752, 957 / 715, 788 | 485, 690 / 449, 522 | 344, 548 / 318, 391 |
| Batch in budget-sized tiers | 914, 1,118 / 718, 791 | 550, 754 / 527, 600 | 329, 534 / 311, 384 |
| Batch as per-file slots | 660, 857 / 603, 668 | 369, 564, 902 / 332, 396, 861 | 257, 376 / 240, 208 |
| Slots, the edit's own files first | 731, 222 / 622, 73 | 407, 222, 903 / 342, 73, 860 | 257, 222 / 240, 73 |
| Batch + edit's tier beside, 4 extra workers | 651, 318 / 594, 283 | **364, 318**, 842 / **327, 283**, 953 | 257, 318 / 240, 283 |
| Batch + edit's tier beside, inside the grant | 1,905, 318 / 1,774, 283 | 558, 318 / 510, 283 | 257, 318 / 240, 283 |

The agent's waits matter only under today's rules. The pattern of each agent's waits (`plan=cadence`) changes today's rows by up to 31%. It does not change the batch rows: a batch persists after its wait ends.

The tradeoff is when results arrive. One batch stores all 55 results at its end (364 s). Today the first named result arrives at 28 s and the median at 372 s. With slots the median is 314 s, or 118 s when slots take the shortest files first (`perfile-output.txt`). So a failing short file is reported later in one batch. Longest-first is Vitest's own order within a run when its cache holds each file's duration (Vitest 4.1.10 `BaseSequencer.sort`: "run longer first"). cezar's `CiTestSequencer` replaces only `shard`, not `sort`. Not determined: whether Squeal's Vitest instance has that cache filled.

**Q3: an edit during the batch** (`cases-output.txt`, 11 workers, one parity wait, the workload's own edit work removed). Each cell: edit latency / verdict / file-seconds lost. Columns: when the edit lands.

| Option | 2 s file at 60 / 180 / 300 s | The trial's 4 own files (40 to 204 s) at 60 s |
| --- | --- | --- |
| Wait for the batch | 307 / 187 / 67, verdict 364, lost 0 | 609, 364, 0 |
| Beside (4 extra workers) | 3, verdict 364, lost 0 | 205, 364, 0 |
| Cancel the batch | 3, verdict 410 / 463 / 409, lost 458 / 1,033 / 429 | 652, 507, 458 |
| Slots, edit first | 62 / 17 / 6, verdict 369 to 371 | 295, 409, 0 |

Which revision the wait follows (inferred, from C4 step 5 and C15): the newest. A batch file whose key an edit moves gets a discarded result (the stability check), as today. That file then rejoins its batch. Today's 011-265 rule stays: only a revision that changed an input of every unfinished file cancels the tier. An edit that reaches no batch file should neither cancel nor delay the batch. Running beside meets that.

**Q4: a one-file wait behind another session's 55-file batch** (same worktree, so one daemon and one queue). Latency for a 2 s / 25 s / 59 s file named at 30 to 330 s:

| Option | 2 s | 25 s | 59 s |
| --- | --- | --- | --- |
| Today's rules | 136 to 313 | 136 to 376 | 136 to 436 |
| Batch, strict order | 38 to 338 | 60 to 360 | 95 to 395 |
| Batch, later wait of at most 30 file-seconds beside | 3 | 26 | 95 to 395 |
| Slots, small wait first | 3 to 92 | 26 to 115 | 90 to 390 |

The verdict for the big wait stays at 364 s in every batch row. The 30 file-second threshold is a probe choice, not a measured optimum. At 6 workers the small wait beside stays at 3 s and 26 s, while strict order and today's rules take 324 to 670 s. At 23 workers the batch ends at 257 s, so a wait at 330 s often finds its file already current (`cases-output-W23.txt`, `cases-output-W6.txt`).

**Q5: streams and re-waits.** Under batch order, the recorded 0.1.377 plan (14 parity waits, 2 own waits) formed 2 batch tiers: 55 files at 17 s, then 4 at 364 s. A re-wait after a deadline adds nothing. So the gaps that cost 0.1.377 its lapses disappear. The cost: a batch nobody waits for any more still holds the lane. Q4's strict row is that cost.

Stream of four-file named waits every 75 s, no edits, 11 workers. Columns: the parity verdict, then when the files no wait names get their first result and their 90th percentile:

| Option | Light stream (24 waits, 1,310 file-s) | Heavy stream (7 waits of files of 30 s or more, 2,281 file-s) |
| --- | --- | --- |
| Today's rules | 1,053; 319; 398 | 1,450; 916; 916 |
| Batch, no bound | 364; 815; 815 | 364; 1,607; 1,607 |
| Batch, turn after 4 batch tiers | 364; 647; 647 | 364; 920; 920 |
| Batch, turn after 1 batch tier | 364; 441; 631 | 364; 435; 435 |

Review S3 (row 011-266) is real under today's rules too: in the heavy stream, unnamed files wait 916 s. Without a bound the batch makes it worse. Today's constant, a turn after four tiers, is too weak when each batch is long. A turn after one batch tier keeps the gate's verdict and bounds the backlog's wait by one batch.

## Recommendation for Squeal

1. **A named wait's files form one batch.** Files it selects that are queued and in no batch join a new batch at the end of the list. The batch persists until each file is current or its key has moved. Re-waits and expired deadlines do not change it. The lane runs the first batch as one tier at its whole grant, with no wall budget. Within the tier, the longest file goes first. Cost: results arrive at the batch's end. Gain at 11 workers: the verdict is 82 to 84% shorter than recorded, and 70 to 75% shorter than today's rules in the model.
2. **The edit's tier runs beside the batch**, in a second Vitest instance (as the slow tier already has its own instance). It takes up to `runner.tierSize` workers above the batch's grant. Taking them from the grant raised the verdict by 53 to 56% at 11 workers and by 193 to 199% at 6; at 23 it cost nothing. Do not cancel the batch for an edit. Do not put edits after the batch: the edit's own files came 2.1 times later on 0.1.374.
3. **Later waits:** in request order. A later wait of at most about 30 file-seconds runs beside, as an edit does.
4. **Fairness:** with backlog queued, one backlog tier after each batch tier. This is row 011-266 S3's bound. S2 (a requested slow run beside a wide tier) remains open.
5. A batch whose estimate exceeds `runner.timeoutMs` still splits under C4's timeout rule. At 2 workers the 55-file batch's estimate is about 1,900 s, more than cezar's 900 s.

## The C4 and C15 sentences that would change

- C4 step 5, "While the queue holds no work an edit caused in a free lane but holds promoted files (C15) … the next tier there holds promoted files only and is chosen as the backlog's: up to `runner.backlogTierSize` files, one per worker at the grant, then more within the same wall budget." Becomes: the next tier is the first batch's (C15), all its queued files at the grant, with no wall budget, whether or not an edit's work is queued.
- C4 step 5, "It does not count toward the four first-group tiers before the backlog's turn, the turn does not go before it…". Becomes: after each batch tier, a queued backlog gets one tier before the next batch.
- C4 step 5, "Tiers run one at a time per lane, except that an edit's tier of a node:test or pytest lane starts beside…". Gains: an edit's tier, and a later wait's small batch, start beside a batch tier in a Vitest lane.
- C4 step 5, "work an edit caused does not cancel it or make it yield: the cut files would go back promoted…". Keep the cancel rule; the reason becomes "the edit runs beside it".
- C15 Rank, "A promoted file counts as work an edit caused (C4 step 4, first group) and goes before every other class in that group". Becomes: a selected file belongs to its wait's batch; batches go in request order ahead of the edit's work, and the edit's work runs beside them.
- C15 Rank, "In a tier beside work an edit caused, it counts toward the four first-group tiers…" and "With no such work queued, promoted files form a tier of their own sized as the backlog's…". Replaced by the batch and its turn.
- C15 Lifetime, "Promotion lasts until the wait's deadline or until none of the selected files is queued or running". Becomes: a batch lasts until each of its files is current or its key moved; the deadline bounds only the wait.

## A slice's done-when, as tests

1. 55 promoted files, no edit's work: one tier holds all 55 at the grant, ordered longest first.
2. The wait's deadline passes mid-batch: the tier runs on. A re-wait of the same files forms no new tier, and no backlog tier starts between waits.
3. An edit reaches one file outside the batch while the batch runs. Its tier starts beside within one scheduling step, and its result lands before the batch ends. The batch is not cancelled.
4. An edit changes an input of some unfinished batch files: the tier runs on, and those files rejoin the batch. One that changes an input of every unfinished file cancels the tier.
5. A second wait naming one file of at most 30 s starts beside. A second wait naming 4 files of 60 s starts when the first batch ends.
6. A stream of 7 four-file waits with backlog queued: a backlog tier follows each batch tier.
7. The wait's line names the batch, its position and its estimated end; `--json` adds this without breaking older readers.

## Open questions

- Not determined: the CPU and memory cost of a second Vitest instance beside a 55-file batch. Neither is the host load from 4 extra workers. The trial ran at load 36 to 39 on 24 CPUs.
- Not determined: whether Squeal's Vitest instance orders a run longest first (cache filled) or by file size.
- No real batch has been measured. Durations held at 5 to 11 workers; 23 at once is unmeasured.
- The thresholds (30 file-seconds, one backlog tier per batch tier) are probe choices. They are not optimized.

## Sources

- Brief `tasks/wave-59.md` R1; board rows 011-265, 011-266, 011-267 and gh-125; `research/issue-79-gate.md`, `research/issue-125.md`; spec 011 C4 steps 4 and 5, C10, C15 at `bb063a9b7`.
- Source at `bb063a9b7`: `src/core/scheduler/tiers.ts` (`selectTier`), `queue.ts` (`ordered`, `tierSelected`, `backlogTurn`), `sharing.ts` (`joinSpan`), `backlog.ts` (`BacklogWall`), `src/runners/vitest/index.ts` (the slow tier's own instance).
- cezar, read-only: `/home/agent/projects/cezar/.git/squeal/store.sqlite` (`runs`, `results`, `checks`, `revisions`, `meta`) and `runs/<id>/report.json`. Trial record `.ai/cezar/worktrees/563b3d1c-…/.ai/qa/2141/squeal-trial.md` and `parity-*.json`. `vitest.config.ts`, `.github/scripts/ci-test-sequencer.mjs`, `node_modules/vitest` 4.1.10 `BaseSequencer`.
- Agent session logs: `~/.codex/sessions/2026/10/29/rollout-2026-10-29T02-19-17-01a1853d-6b87-….jsonl` (0.1.374) and `rollout-2026-10-29T10-26-02-01a186fb-0ea2-….jsonl` (0.1.377).
- Probes: `probes/011-267/` with outputs `replay-output.txt`, `cases-output*.txt`, `perfile-output.txt`, `widths-output.txt`, `width-inferred-output.txt`, `summary.txt`, and data `traces.json`, `waits.json`, `lastknown.json`, `replay.jsonl`, `cases-W*.jsonl`. Load at the last run: 11.76 on 24 CPUs (`load.json`); the model does not depend on load.
