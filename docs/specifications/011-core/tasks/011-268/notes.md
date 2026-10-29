# 011-268 and 011-269: a named wait's batch, and work beside it

Worker f93d0f43, 2026-10-29. Brief: `tasks/wave-59.md` W1. Source: `research/named-wait-batches.md` (Recommendation, the C4 and C15 sentences, the seven done-when tests). Sections 1 to 7 are row 011-268; row 011-269 adds section 8.

## 1. What changed (row 011-268)

A named wait's selected files that are queued or running and in no batch form a **batch**, after the others (`Promotions`, `src/core/scheduler/promotions.ts`). A file stays in its batch while it is queued or running, past the wait's deadline. It leaves when its result is current, or when it leaves the queue (a delete, a block, an install that clears the queue). A re-key during its run puts it back in the queue, so it stays. A selected file in no batch that is queued again before the deadline (an edit during the wait) joins the batch. After the deadline the batch only loses files. A wait that finds no file to add, as a re-wait of the same files does, forms no batch. The batch ends when its last file left.

Selection (`selectTier`, `tiers.ts`, with `batchFiles`, `batchTurnDue` and `batchBudget` in `promoted-tier.ts`):

- In a free lane whose runner runs its backlog in tiers, a batch's tier goes first, whether or not an edit's work is queued. It holds the files of one batch, the first with a file that can start. Order: `RunQueue.orderedBatches`, the earlier batch first, then the longest last-known duration first (unknown last).
- Size and width: up to `runner.backlogTierSize`, at the grant, as a backlog tier (`kind: "backlog"`, `Tier.promoted`). No 120 s wall budget. The bound is `runner.timeoutMs`, on the same estimate (`BacklogWall`) at the grant: a tier estimated past the run's deadline would time out. A grant below the offer trims the tail by the same bound.
- The backlog's turn: a batch's tier does not count toward the four first-group tiers, and the old turn does not go before it. After a batch's tier, while a fast file in no batch is queued, the next tier goes to those files (`RunQueue.batchSelected`, `batchTurn`): `selectTier` runs with `rest`, as if no batch were queued, so it is the backlog's tier, or an edit's tier when an edit's work is queued. When that selection starts nothing, the batch goes. Any other tier selected clears the turn.
- Claims (C7), slot lanes and a lane's wait for quiet: as row 011-265 left them.

Yields: a batch's rank does not lapse at its wait's deadline (`PromotionRank.until` is `null`), and `rankToBeat` (`yields.ts`) gives every tier its rank to beat from its start (the coordinator's reply to request 579e56f4). So a file of the same or a later batch never cuts a tier that runs a file of an earlier or the same batch. A file of an earlier batch still cuts as `startsSooner` says, and a tier with no batch file is cut as before. A batch's tier is exempt from an edit's cancel and cut while a file of it that has not ended is in its batch, which holds until the file ends.

Status (`standing.ts`, `next-step.ts`, `standing-groups.ts`, `named-file-lines.ts`): the daemon publishes each batch in the `promotions` meta row: the files its wait selected as `files` and the wait's deadline as `until`, as before, so an older reader reads a promotion until the deadline; and `batch: { files, estimatedEnd }`, the batch's own files. `estimatedEnd` is set when the batch's tier starts (its start plus the wall estimate of its files at the tier's width) and cleared once none of its files runs. `publishedBatches` reads each file's place: position, count, files, estimated end. A running or queued file of a batch reads, for example:

- `in the vitest tier of 55 test files running since 10:00:00, in batch 1 of 2 (55 files), its tier estimated to end at 10:07:41`
- `queued, promoted, in batch 2 of 2 (4 files), after batch 1, behind the vitest tier of 55 test files running since 10:00:00`

The only batch says nothing more while its tier has not started, so a lone queued promoted file reads as before. `--json` adds `batch` (`position`, `of`, `files`, `estimatedEnd`) to the file's entry.

Measured on the scheduler fixture (`test/scheduler/batch-tier.test.ts`, test 1): 55 promoted files of 2 s to 218 s beside 20 backlog files at 24 slots. On the base commit the first tier took the 24 shortest (`expected [ 'test/p000.test.ts', …(23) ] to deeply equal [ 'test/p054.test.ts', …(54) ]`). Now one tier takes all 55, longest first, at a grant of 24.

## 2. Spec sentences to amend

C4 step 5. Replace the paragraph of rows 011-265 and B1, from "While the queue holds no work an edit caused in a free lane but holds promoted files (C15) in one whose runner runs its backlog in tiers, ..." up to and including "...With none open, it is a backlog tier as any. (Amended 2026-10-29, review `reviews/0.1.377.md` B1: ...)", with:

> While a free lane whose runner runs its backlog in tiers holds a file of a named wait's batch (C15), the next tier there is the first such batch's, whether or not work an edit caused is queued: its files that can start, longest last-known duration first (unknown last), up to `runner.backlogTierSize`, one per worker at the grant, then more while the same estimate stays within `runner.timeoutMs`, not the 120 s budget. It takes the backlog's grant and waits for a permit (C10). It does not count toward the four first-group tiers before the backlog's turn, the turn does not go before it, and a lane's wait for quiet does not hold it. After it, while a fast file in no batch is queued, the next tier is chosen as if no batch were queued, the backlog's or an edit's, before the next batch's tier. While a file of it that has not ended is in its batch, only the revisions that changed an input of every such file cancel it, and work an edit caused does not cancel it or make it yield: the cut files would run again in their batch's tier. A file of an earlier batch, a focused entry or a runner part that waits for the run still makes it yield as below; with none of them, the wait's line names the reason (`named`). (Amended 2026-10-29, the human, decision card "Build as recommended", row 011-268, `research/named-wait-batches.md` Recommendation 1, 3, 4 and 5: in a one-lane replay at 11 workers, the 56-file gate's verdict took 364 and 327 s, against 1,978 and 2,053 s recorded; with one backlog tier after each batch tier, a stream of heavy waits gave the unnamed files their first result at 435 s, against 1,607 s with no bound.)

Keep the next two sentences ("A lane whose runner runs its backlog in slots keeps its promoted files in an edit's tier. When no promoted file can start, ...") and their amendment note.

C4 step 5, the yield rule. In "Any other tier but the backlog's turn after four tiers of the first group and, for work an edit caused, a tier of promoted files only while a file of it has an open promotion (above) yields", replace "a tier of promoted files only while a file of it has an open promotion" with:

> a batch's tier while a file of it is in its batch

C4 step 5, the rank to beat. Replace "A promoted file makes a tier that has run 30 s or more, or a tier of promoted files only at any time, yield only when it ranks before every file of the tier that has not ended (C15's rank: a file an open wait selected ranks by that wait's request, any other after every promoted file). So once a tier has run 30 s, it does not cut a file that the same or an earlier open wait selected for that wait's other files: the wait returns only when each file it selects is current (005 D2), and the cut would delay it by up to the time that file had run. A tier of promoted files only has this rule from its start: a cut of files its wait selected delays that wait's verdict and loses their run." with:

> A promoted file makes a tier yield only when it ranks before every file of the tier that has not ended (C15's rank: a file of a batch ranks by its batch, any other after every batch's file). So it never cuts a file of the same or an earlier batch: the wait returns only when each file it selects is current (005 D2), and the cut file would run again in its batch's tier with the file it was cut for, so that file's result would land no sooner and the run would be lost. (Amended 2026-10-29, row 011-268, the coordinator, request 579e56f4: before, a tier had this rule only once it had run 30 s, and a wait at 10 s that selected a running file and a queued one cut the running file, which then ran again with the queued one.)

In "It also yields, once per file and key, when it has run 30 s past its estimate, ... unless the tier runs a file that wait or an earlier open one selected (below)", replace "a file that wait or an earlier open one selected" with "a file of that wait's batch or an earlier one". In "The tier is decided again when one of its files ends and at the deadline of the first promotion that ranks one of its files.", delete " and at the deadline of the first promotion that ranks one of its files".

In "A backlog tier in flight, other than a tier of promoted files only while a file of it that has not ended has an open promotion, is cancelled by ...", replace "a tier of promoted files only while a file of it that has not ended has an open promotion" with "a batch's tier while a file of it that has not ended is in its batch".

C10, the edit's-tier bullet. Replace "A tier of promoted files only (C4 step 5, row 011-265) is a backlog tier here: it takes a grant and waits for a permit." with:

> A batch's tier (C4 step 5, rows 011-265 and 011-268) is a backlog tier here: it takes a grant and waits for a permit.

C15 Rank. Replace "A promoted file counts as work an edit caused (C4 step 4, first group) and goes before every other class in that group, failing files included. Among promoted files, the earlier request goes first, then C4's order." with:

> A named wait's selected files that are queued or running and in no batch form a batch, after the others; a wait that finds none, as a re-wait of the same files does, forms none. A batch's file counts as work an edit caused (C4 step 4, first group) and goes before every other class in that group, failing files included. Batches go in request order. In a lane that runs its backlog in tiers, a batch runs as one tier, longest first (C4 step 5); in a lane of slots, C4's order (row 011-268).

Replace "In a tier beside work an edit caused, it counts toward the four first-group tiers after which the backlog gets its turn, so named waits beside edits cannot starve the backlog. With no such work queued, promoted files form a tier of their own sized as the backlog's, which does not count toward the turn (C4 step 5, row 011-265)." with:

> In a lane of slots it joins an edit's tier and counts toward the four first-group tiers after which the backlog gets its turn. In a lane that runs its backlog in tiers, a batch's tier does not count toward that turn; after each one, while a file in no batch is queued, those files get the next tier, so a stream of waits cannot starve the backlog (C4 step 5, row 011-268).

Replace "only when the cut starts it before that remainder (row 011-263), and, once the tier has run 30 s, only when the tier runs no file that the same or an earlier open wait selected (row 011-184)" with:

> only when the cut starts it before that remainder (row 011-263), and only when the tier runs no file of the same or an earlier batch (rows 011-184, 011-268)

C15 Lifetime. Replace "Promotion lasts until the wait's deadline or until none of the selected files is queued or running, whichever comes first." with:

> A file stays in its batch while it is queued or running, past the wait's deadline: until its result is current at its key, or it leaves the queue. A selected file in no batch that is queued again before the deadline (an edit during the wait) joins the batch; after the deadline the batch only loses files. A batch ends when its last file left. The deadline bounds only the wait (row 011-268).

In the same paragraph, replace "so a killed CLI leaves promotion in place for at most its own `<ms>`, and no cancel message or lease is needed" with:

> so a killed CLI leaves its batch in place until the batch's files settle, as a re-wait would need them, and no cancel message or lease is needed

C15, "What the wait says", the queued line. After "...or a runner that runs each tier to its end (node:test, pytest, a backlog slot); amended 2026-10-21, rows 001-381 and 011-51)", append:

> ; a file of a batch reads `in batch N of M (K files)` after `promoted`, then `after batch N−1` for a later batch, or, while its batch's tier runs, `its tier estimated to end at HH:MM:SS` (the running line too); the only batch says nothing more before its tier starts. `--json` adds `batch` (`position`, `of`, `files`, `estimatedEnd`) to the file's entry. Each entry of the `promotions` row keeps `files` and `until` and adds `batch`, so a reader before row 011-268 reads each entry as a promotion until its deadline (row 011-268)

## 3. Decisions and deviations

| Question | Choice | Who |
| --- | --- | --- |
| Which selected files join a batch | Queued or running, and in no batch. The research says "queued". A running file of another tier then keeps its rank (row 011-184's rule) and stays in the batch if a cut or a discard queues it again. | Worker |
| When a file leaves its batch | When it is neither queued nor running: its result is current, or it left the queue. A re-key during its run keeps it (done-when 4: "those files rejoin the batch"). The research's "or its key moved" is read as this: a moved key queues the file again. | Worker |
| A selected file queued again while the wait is open | It joins the batch (C15's "promoted too"). After the deadline it does not. | Worker |
| A request already past its deadline | Forms no batch: that wait has ended, and a CLI sends no request then (task 011-11). Found by `promotion.test.ts`, "a promotion past its deadline orders nothing", which passes as written. | Worker |
| A wait whose open files are all in earlier batches | No batch and no position, but kept as a join window until its deadline while a file of it is open, so a file of it queued again meanwhile joins it (C15's "promoted too"). Found by the model's invariant F, seed 24: such a wait was dropped, and its other file, queued later, had no rank. | Worker |
| What the row's `files` holds | Every file the wait selected, as before: an older reader and row 011-195's model read them. The batch's own files are `batch.files`. | Worker |
| `PromotionRank.until` | `number \| null`, `null` for every batch. `yields.ts` and `yield-sooner.ts` compile unchanged. | Coordinator, request bdd8a1ed |
| The yield rule before 30 s (`rankToBeat`) | Deleted the branch that gave a tier no rank to beat before 30 s. It was found by `tier-yields-named.test.ts` tests 2, 3, 5 and 6: a wait selecting a running file A and a queued file P put both in one batch; the cut A ran again in the batch's tier with P, so P's result landed later than with no cut. This is the only `yields.ts` edit. | Coordinator, request 579e56f4 |
| The batch's size | Up to `runner.backlogTierSize`. Not split with other daemons (`Claims.backlogSize`): the batch is this worktree's wait. | Worker |
| The batch's bound | The estimate within `runner.timeoutMs` at the grant, not 120 s (research Recommendation 5). The reactive timeout split (`requeueSplit`, `tierCap`) is unchanged. | Worker, from the research |
| One batch per tier | Yes. The tier takes the first batch whose file can start. A claimed file is skipped, so the next file decides the batch. | Worker |
| The tier after a batch's | The research model's turn: any non-batch tier, an edit's included (its `turnDue` counts edits and the rest). The flag is global, as the four-tier turn's counter is. When the turn's selection starts nothing (a wait for quiet, claims, the pool), the batch goes, and the flag stays. | Worker, from the research |
| A batch with an edit's work queued | The batch goes first; row 011-269 runs the edit's tier beside it. | Research |
| Status words | The batch is named only when more than one is live or its tier runs, so a lone queued batch's line reads as before. A later batch shows `after batch N−1`, not an estimate: its start depends on the turn and the pool. | Worker |
| The estimated end | Set at the tier's start; cleared once none of the batch's files runs, so a stale estimate never shows. | Worker |

## 4. Consequences and limits

- A batch nobody waits for any more still holds the lane until its files settle, bounded by one backlog tier after each of its tiers. This is the research's accepted cost (Q4, strict order).
- A cut of an edit's tier that holds a file of a batch puts that file back in its batch, so it runs in the batch's tier: `tier-yields-named.test.ts` 5 and 6 show `[[A, P], …]`. Row 011-269 lets an edited batch file run beside instead (coordinator, request e3edd85b).
- A named file in a Vitest lane no longer shares an edit's tier with other files (`tier-yields-overrun.test.ts`): its batch's tier holds its batch only. Row 011-112's sharing rule still applies among an edit's tier's files.
- Results of a batch arrive at its tier's end. A failing short file is reported later than in a tier of 4 (research Q2: the first named result at 28 s today, at the batch's end with one batch).
- Not determined, as the research says: whether Squeal's Vitest instance runs a tier's files in the order given (longest first) or by its own sequencer.

## 5. Dead code, for a later cleanup

Not removed, because `yields.ts` takes only the one edit above (coordinator, request bdd8a1ed):

- `Beat.until` in `yields.ts` is always `null` now: no rank has a deadline.
- `boundOf`'s `Math.min(own, beat.until)` for a promoted tier (review B1, rule 3: decided again at the promotion's deadline) never arms.
- `decidedBound`'s `named` bound (`beat.until`) is always `null`.
- `PromotionRank.until` itself, and `Promotion.until` now only gates joining.
- `cancelsBacklog`'s `selected` is true for a batch's tier until its files end; the "With none open, it is a backlog tier as any" branch now holds only for a tier whose unfinished files all left their batch, which a running file cannot do.

## 6. Tests

New (each red on the base commit `bb3b29116`, run in a private copy with a stub `publishedBatches` that returns an empty map):

- `test/scheduler/batch-tier.test.ts` (catch-up fixture, `batch-fixture.ts`): test 1 (red: the first tier took the 24 shortest); test 2 at 4 slots, past the deadline, a re-wait forms no batch and the backlog gets one tier between the batch's tiers (red: shortest first, and with the published checks removed, the tier after the first held `test/p012.test.ts` and three more of P); past the deadline an edit's work does not cancel the batch's tier (red: `cancelled` true), the coordinator's test; test 5's second half, a later wait of 4 files of 60 s starts after the batch, with the backlog's one tier between (red: `cancelled` true, the tier was cut).
- `test/scheduler/batch-select.test.ts` (`selectTier` on a `Ledger`): test 6, 7 waits of 4 files and 28 backlog files alternate (red: the 7 batches ran first); batches follow one another with no backlog; a re-wait past the first deadline forms no batch (red).
- `test/scheduler/batch-line.test.ts`: test 7, the running and the queued lines and `--json` name the batch, its position and its estimated end, and the `promotions` row keeps `files` and `until` (red: no `batch` in the standing); a row of a daemon before this row reads as promotions until their deadlines.

Setup changes in existing tests, each for a rule this row changes:

- `promoted-tier-select.test.ts`: "with an edit's work queued" now expects one batch tier; the claim test is split into "free of claims" and "every promoted file claimed" (the second pick after a batch tier is now the backlog's turn); "does not count toward the turn" is replaced by test 6 and by "the four-tier turn does not go before a batch".
- `promoted-tier.test.ts`: with an edit's work queued, the 56 files run in one wide tier, not 14 of 4.
- `promoted-tier-expiry.test.ts`: review B1's paired test is inverted (past P's deadline B099 does not cut the tier, with or without an edit's work); the line still says `named` past the deadline; S1 at 4 slots: the batch's tier takes all 56 within the run's deadline and E starts next (was: 12 of 56, E in the 14th tier).
- `promoted-tier-fixture.ts`: `heldWide` expects all of P; the `takes` option is gone.
- `promoted-tier-bound.test.ts`: past P's deadline the tier is neither cancelled for the edit's work nor cut for Q; an edit's tier of P does not yield to a later batch's Q; new: a file of an earlier batch still cuts an edit's tier, and an edit's tier with no batch file yields at once, as before.
- `tier-yields-named.test.ts` (row 011-184): 2, the same wait at 10 s no longer cuts the tier; 3, P of an earlier batch still cuts it, and A runs in its batch's tier after the cut's other files; 5 and 6, the edit's work still cuts it, and A runs again with P in their batch's tier; 9, 10 and 11, the earlier wait's deadline no longer makes the tier yield. Each test says why.
- `tier-yields-clock.test.ts`, seed 60: P is of s4's batch, so the tier stands `named`, not `remainder`.
- `tier-yields-next-tier.test.ts` (row 011-263): Q of a later batch no longer cuts a tier that runs s1 of an earlier one (a cut s1 would run alone in its batch's tier before Q's); past A's deadline the three stay in A's batch and the tier runs on.
- `promotion-cut.test.ts`, 016-18's F: the cut that queues s4 again is now an edit's work (P edited), since a later wait's P no longer cuts a tier that runs an earlier batch's s4. The point stands: the record keeps s4 in its batch.
- `edit-cut-route.test.ts`, test 8: the wait's files run in their batch's tier, which takes a grant, so the test finds that tier instead of reading them among the edit's tiers.
- `tier-yields-overrun.test.ts`: the remainder-cut case now runs F alone in its batch's tier: `[[F], SLOW]`.
- `queue-promotion.test.ts`: "ends at the deadline" became "lasts past the deadline while its file is queued".
- `promotions-published.test.ts`: the published entry adds `batch` with the batch's own files; past its deadline the batch lives on until its files settle.
- `model-checks.ts` and `model-fixture.ts` (row 011-195's model): the oracle ranks a file by its batch, past the wait's deadline, as the daemon does, and reads `batch.files`; invariant F becomes "while a wait is open, each queued or running file of it ranks". On the old oracle, B (seed 24: a tier stood `named` while an earlier wait's s4 had passed its deadline) and F failed. All seven invariants pass.

## 7. Type changes

- `PromotionRank.until`: `number` became `number | null` (not additive; internal; coordinator, request bdd8a1ed).
- Additive: `PublishedPromotion.batch?`; `BatchPlace` (`src/core/types/standing.ts`); `batch?: BatchPlace` on the `running` and `queued` standings and on `NamedFileEntry`; `RunQueue.batchStarted`, `batchSelected`, `batchTurn`, `orderedBatches`; `Promotions.started`; `Ledger.orderedBatches`; `publishedBatches`; `selectTier`'s trailing `rest = false`.
- `promoted-tier.ts`: `promotedOnly` is replaced by `batchFiles`, with `batchTurnDue` and `batchBudget` beside it. Nothing outside the scheduler imported it.

## 8. Row 011-269: an edit's tier and a small later wait beside the batch

### What changed

In a lane whose runner cancels a run (Vitest), while a batch's tier runs, one tier at a time starts beside it (`besideFiles`, `src/core/scheduler/beside.ts`; the pump's `#besideTier` in `scheduler.ts`, after `selectTier` finds no free lane). It takes:

- work an edit caused in the lane, a file of a batch included: that file keeps its batch for rank and status (coordinator, request e3edd85b);
- each later batch whose queued files there hold at most 30 s of last-known time (`BESIDE_BATCH_MS`), none unknown.

It is an edit's tier: `runner.tierSize` files that share by duration (`joinSpan`), no grant and no permit, `kind: "edit"`, `Tier.beside`. `selectTier` selects it with `pass.beside` as its only filter, and it counts toward neither the four-tier turn nor the batch's turn. `executeTier` runs it with `RunOptions.lane` `BESIDE_LANE_PREFIX` and the lane (`src/core/types/runner.ts`). `withSlowInstance` (`src/core/daemon/slow-instance.ts`) sends such runs to a third instance, made by `daemon.ts` with `vitestInstance("beside:vitest", runner.tierSize)` on its first run. So the tier takes at most `runner.tierSize` workers above the batch's grant. The slow instance's code moved into a shared `LaneInstance` class with no change in behaviour. When a batch's tier or a tier beside one ends, and the lane has no batch's tier, no tier beside one and no batch file queued, the scheduler releases the beside lane, which closes the instance (`besideDone`, `#besideEnded`).

The batch's tier is not cancelled for an edit unless the edit changed an input of every unfinished file of it (supersession, as before). An edited file of it is queued at its new key while the batch's run of it at the old key goes on. The tier beside runs it at the new key. Whichever ends first, the batch's outcome for that file is superseded (`supersededIn`, row 011-21) or discarded by the stability check, so a result at the old key never counts as current.

The lane stays busy for other tiers while the batch's tier or the tier beside it runs. When the batch's tier ends first, the lane's next tier waits for the tier beside to end. That tier holds at most `runner.tierSize` files.

### Spec sentences to amend

C4 step 5. After the batch paragraph of section 2 (it ends "...against 1,607 s with no bound.)"), insert:

> In a lane whose runner cancels a run (Vitest), while a batch's tier runs, one tier at a time starts beside it in a second instance of the lane's runner: work an edit caused, a file of a batch included, which keeps its batch for rank and status, and each later batch whose queued files hold at most 30 s of last-known time, none unknown. It is an edit's tier: `runner.tierSize` files that share by duration, no permit (C10), and it counts toward neither turn. An edited file of the batch runs beside at its new key; the batch's run of it at the old key is superseded or discarded, as the run of a backlog slot an edit's tier supersedes (row 011-21), so it never counts as current. The second instance is made on the first such tier and closed once the lane has no batch's tier, no tier beside one and no batch file queued. (Amended 2026-10-29, the human, decision card "Build as recommended", row 011-269, `research/named-wait-batches.md` Recommendation 2 and 3: at 11 workers, a 2 s edit file beside the batch was current in 3 s, against 67 to 307 s after it, and the verdict did not move; a one-file wait of 2 s got its result in 3 s, against 38 to 338 s in strict order. Not measured: the second instance's CPU and memory. The coordinator chose that an edited batch file runs beside, request e3edd85b.)

C10, the first runner bullet. After "Runs go one at a time per lane (D5 step 5 as amended, task 001-140)", insert:

> , except that a tier beside a named wait's batch runs in a second instance of its lane's runner (C4 step 5, row 011-269)

C10, the edit's-tier bullet. Append:

> A tier beside a batch's tier (C4 step 5, row 011-269) is an edit's tier here: no permit, in a second instance of `runner.tierSize` workers, so the host runs up to that many workers above the batch's grant.

C10, Runner ceiling. After "An edit's tier, which carries no grant, runs at the project's own width", insert:

> , a tier beside a batch's at `runner.tierSize` under the same ceiling and floor (row 011-269)

The research's C4 sentence "Tiers run one at a time per lane, except that an edit's tier of a node:test or pytest lane starts beside…" is not in the spec as quoted. The rule it names is C4 step 5's "Such a runner runs each slot to its end, and an edit's tier of its lane starts beside it, with no permit (C10)", which is unchanged; the C10 sentence above takes its place.

### Decisions

| Question | Choice | Who |
| --- | --- | --- |
| Where the second instance lives | `withSlowInstance` routes `BESIDE_LANE_PREFIX` runs to a third instance; `daemon.ts` makes it; no instance inside `adapter.ts`. The brief's `adapter.ts:742` named a comment; `withSlowInstance` is `src/core/daemon/slow-instance.ts`. | Coordinator, request 0ca715c0 |
| An edited batch file | Keeps its batch for rank and status, and runs beside at its new key. | Coordinator, request e3edd85b |
| A small later batch | The 30 file-seconds are summed over its queued files in the lane; a file with no known duration makes it not small. Any queued batch other than the running ones may go beside, earliest first in the tier's order, as the research model did on each wait's arrival. | Worker, from the research |
| How many tiers beside | One at a time per lane. A small batch of more than `runner.tierSize` files runs beside in several tiers, one after another. | Worker |
| `RunOptions.workers` for the tier beside | None: the instance is `runner.tierSize` wide, and a run without a grant runs at the instance's width. | Worker |
| The lane while the tier beside runs alone | Busy: the lane's next tier waits for it to end, as the research model's lane did for its beside flight. | Worker |
| When the second instance closes | When a batch's tier or a tier beside one ends and the lane has none of them and no batch file queued, so a stream of batches keeps one instance. | Worker |
| The batch's standing once its waiting work went beside | The tiers in flight are checked again when a tier starts beside (`#cutTiers(null)`), so the batch's tier no longer stands `named` for work that left. Without it, the standing stayed until the next event. | Worker |

### Tests

New, each red on the 011-268 commit `95a3bc317` (private copy, with `BESIDE_LANE_PREFIX` and `isBesideLane` stubbed into its `runner.ts`):

- `test/scheduler/batch-beside.test.ts`: test 3, E's tier starts beside, in the beside lane with no grant, and E is current while the batch is held; the beside lane is released only once the batch ended (red: E never current while the batch was held). Test 4, an edit of three of P keeps them in batch 1 of 1, they run beside, and while their runs beside are held the batch's run at their old keys ends and none of the three is current; then they are current at their new keys (red: no run beside). Test 4, an edit of `src/p.ts`, an input of every file, cancels the batch's tier (passes on 011-268 too: supersession is unchanged). Test 5's first half, a later wait of S (one file of 2 s) runs beside and S is current while the batch is held (red). Test 5's second half is `batch-tier.test.ts` test 5 (Q's 4 files of 60 s start after the batch).
- `test/daemon/slow-instance.test.ts`: a beside lane runs in a third instance, each second instance gets edits before its own next run, a beside lane's release closes only it, and the slow instance is untouched (red: the beside runs went to the fast instance); without `createBeside`, a beside lane runs on the fast instance. The five slow-lane tests before pass as written.

Setup changes in existing tests:

- `catch-up-fixture.ts`: `CatchUpRun.lane`; `CatchUpRunner.holdOf`, a run's own hold before the shared one, so a run beside a held batch neither waits for nor ends the hold; `CatchUpRunner.released` with a `releaseLane` that records the lane.
- `batch-fixture.ts`: the batch's run and the runs beside it wait on separate `Gate`s.
- `focused.test.ts`: `holdWhere` leaves a run beside a batch alone; in test 1, the cut edit files now run beside F's batch tier, and through the shared hold that run released F's own run early.
- `tier-yields-fixture.ts`, `holdRuns`: a run beside a batch of files it holds is held as any run; one of other files runs at once and does not open the gate, so the batch's run stays held. A first version let every beside run go, and `tier-yields-overrun.test.ts` and `tier-yields-kept.test.ts` then saw held cut files run.
- `promoted-tier.test.ts`, "an edit's work waits for it to end" became "an edit's work runs beside it, and it runs on": E is current while the wide tier is held, and nothing waits for the tier.
- `promoted-tier-expiry.test.ts`: E and B099 (one file of 1 s) run beside the tier, so the tier stands for nothing; the running line of P000 names its batch and the estimated end before and past P's deadline; at 4 slots E starts beside at once.
- `tier-yields-named.test.ts`, test 3: after the cut, A, an edit's work of the later batch, runs beside P's batch tier with the cut's other files, or after them when P's tier ended first; the test checks P runs first, alone, and each cut file runs again once.

### Type changes

All additive: `BESIDE_LANE_PREFIX`, `isBesideLane` (`src/core/types/runner.ts`); `Tier.beside`; `SelectPass` and `selectTier`'s trailing `pass`, which replaces 011-268's `wide` and `rest` (internal callers only); `startTier`'s trailing `{ promoted, beside }` replaces its `promoted` flag (one caller passes it); `withSlowInstance`'s third parameter `createBeside`; `besideFiles`, `besideDone`, `BESIDE_BATCH_MS` in `src/core/scheduler/beside.ts`.

### Not done, and open

- The second instance's CPU and memory beside a 55-file batch are not measured (research open question 1); neither is a real Vitest run with two instances at once in one worktree.
- Whether Vitest runs a tier's files in the order given (longest first) is not determined (research open question 2).
- `src/core/scheduler/tiers.ts` is 787 lines (719 before these rows) and `scheduler.ts` 1,396 (1,365), both over the styleguide's 300; `selectTier` is over the complexity bound, as it was before.
