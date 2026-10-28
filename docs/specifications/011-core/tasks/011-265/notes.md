# 011-265: a tier of promoted files only is sized as the backlog's

Worker c4aa7999, 2026-10-28. Brief: `tasks/wave-58.md` W1. Source: `research/issue-79-gate.md`, Method's option B, Findings, Recommendation 1. Gh-79, gh-121.

## 1. What changed

Before this row, a promoted file (C15) was work of the first group, so it always ran in an edit's tier: `runner.tierSize` files (4), no grant, held to comparable durations by tier sharing. 56 named files ran in 14 tiers, one after another, each as long as its slowest file.

Now `selectTier` first asks `promotedOnly` (`src/core/scheduler/promoted-tier.ts`). When the free lanes hold no work an edit caused and one of them holds a promoted file whose runner runs its backlog in tiers, the tier is chosen as the backlog's, from promoted files only:

- Size and width: up to the backlog's size (`Claims.backlogSize`), one file per worker at the grant, then more while `BacklogWall` stays within the wall budget. No tier-sharing ratio.
- Pool: it takes the backlog's grant and waits while no permit is free, as a backlog tier does.
- Kind: `backlog`, with the new flag `Tier.promoted`.
- The backlog's turn: the tier does not count toward the four first-group tiers (`RunQueue.tierSelected` is not called), and a due turn does not go before it.
- Wait for quiet: the lane's wait after a backlog cancel (row 011-82) does not hold it. The spec already says a promoted file is not held.
- Cancel: only the first rule cancels it, a revision that changed an input of every file of it that has not ended (supersession). `cancelsBacklog` returns false for it.
- Yields: an edit's work in its lane does not make it yield. `TierYields.#decide` makes it stand `named`. Promoted files of a later wait still make it yield, as they make any backlog tier yield (rows 011-51, 011-184, 011-263).
- Claims (C7): a promoted file that waits on another worktree's claim of its key is skipped, as before. The free promoted files form the tier. When none can start, `selectTier` selects again without the rule (its new trailing parameter `wide`), so the queue starts as it did before this row.

With an edit's work queued, nothing changes: promoted files lead the first group in edit tiers of `runner.tierSize`.

Measured on the scheduler fixture (`test/scheduler/promoted-tier.test.ts`, first test). The setup is 56 promoted files of 31 s beside 100 backlog files at 24 pool slots. Before the change, 14 tiers of 4 ran (Squeal at revision 1: "expected ... to have a length of 1 but got 14"). After the change, one tier of 56 runs with a grant.

## 2. Spec sentences to amend

C4 step 5. After the sentence that ends "...no hard wall-clock cap exists (review wave 12b, S1) (`lessons.md`, defect 25: 559 tiers of 4 took 4.6 h where the project's own run took 514 s; task 001-124).", insert:

> While the queue holds no work an edit caused in a free lane but holds promoted files (C15) in one whose runner runs its backlog in tiers, the next tier there holds promoted files only and is chosen as the backlog's: up to `runner.backlogTierSize` files, one per worker at the grant, then more within the same wall budget. It takes the backlog's grant and waits for a permit (C10). It does not count toward the four first-group tiers before the backlog's turn, the turn does not go before it, and a lane's wait for quiet does not hold it. Only the revisions that changed an input of every file of it that has not ended cancel it. Work an edit caused does not cancel it or make it yield: the cut files would go back promoted, rank before that work and run in tiers of `runner.tierSize`, so the edit's file would start no sooner. A lane whose runner runs its backlog in slots keeps its promoted files in an edit's tier. When no promoted file can start, because each waits on another worktree's claim of its key (C7), the lane's other files start as they would beside promoted files in an edit's tier. (Amended 2026-10-28, the human, decision card "Larger groups", row 011-265, `research/issue-79-gate.md` option B: 56 named parity files beside 537 others reached a verdict in 343 s instead of 1,096 s at 23 workers, and in 24 to 51% less time at 8, simulated. The coordinator chose the cancel rule, the slot-lane rule and the claim rule.)

C4 step 5, the yield rule. In "Any other tier but the backlog's turn after four tiers of the first group yields, once per file and key, while work an edit caused or a promoted file (C15) is queued in its lane, ...", insert after "first group":

> and, for work an edit caused, a tier of promoted files only (above)

C4 step 5, the backlog cancel. In "A backlog tier in flight is cancelled by a revision whose content re-key queues work an edit caused in the tier's lane, or that changes an input of the tier", insert after "A backlog tier in flight":

> , other than a tier of promoted files only,

C10, the bullet "An **edit's tier** (one that holds work an edit caused) runs at `runner.tierSize` without a permit ...". Append:

> A tier of promoted files only (C4 step 5, row 011-265) is a backlog tier here: it takes a grant and waits for a permit.

C15 Rank. Replace "It counts toward the four first-group tiers after which the backlog gets its turn, so a stream of named waits cannot starve the backlog." with:

> In a tier beside work an edit caused, it counts toward the four first-group tiers after which the backlog gets its turn, so named waits beside edits cannot starve the backlog. With no such work queued, promoted files form a tier of their own sized as the backlog's, which does not count toward the turn (C4 step 5, row 011-265).

## 3. Decisions and deviations

| Question | Choice | Who |
| --- | --- | --- |
| Slot lanes (node:test, pytest). The probe's B applied to every runner, but it modelled a Vitest-like runner only. In a slot lane a backlog tier is one slot (1 file or one pytest batch), narrower than 4. `busyLanes` also counts only non-backlog tiers as an edit's, and `besideBacklog` is true there, so promoted slots would start beside each other with no `runner.tierSize` bound. | Deviation from the probe: a slot lane keeps its promoted files in an edit's tier, as before. `promotedOnly` takes only files whose `backlogSlot` is `null`. | Coordinator, reply to request b52ab0a5 |
| An edit's cancel. The brief said an edit cancels the tier as it cancels a backlog tier. The first version did so, and its test showed the cost: 56 promoted files held in one tier, an edit of `src/e.ts` cancelled it, then 14 tiers of 4 promoted files ran, then `e.test.ts`. The cut files stay promoted and rank before the edit's work (C15 Rank). | Deviation from the brief: only supersession cancels the tier (`cancelsBacklog` returns false for `Tier.promoted`). An edit's work does not make it yield either: `#decide` returns `{ kind: "named" }` when `waitedFor` says `"edit"`. Without that line, the remainder rule (row 001-381) cut the tier for the same edit (checked: the "waits for it to end" test failed with the line removed). Done-when 3 became (a) an edit to a file that is not an input of the tier lets it run on, and the edit's file starts in the next tier, and (b) an edit that changes an input of every unfinished file still cancels it. | Coordinator, reply to request 7826d334 |
| Claims (C7). The existing test `promotion.test.ts` "a promoted file whose key another worktree runs waits for its claimant (C7)" failed on the probe's rule. Worktree a's only promoted file waits on worktree b's claim, the promoted-only order holds that file alone, and the tier picks nothing. So a's backlog starts nothing until b's run ends. Before this row, an edit's tier of `runner.tierSize` took a's backlog file. The probe had one worktree, so it never met a claim. | Deviation from the probe: when the promoted-only pass picks no file, `selectTier` selects again without the rule (`wide = false`). The free promoted files still form the wide tier when only some are claimed. Test: `promoted-tier-select.test.ts` "takes the promoted files free of claims; with none free, starts as before (C7)". `promotion.test.ts` passes as written. | Coordinator, reply to request 88c59c1f |
| The backlog's turn counter. The probe's patch still called `tierSelected(false)`, so each B tier added one to the counter. No probe plan had an edit after t0, so no measured result depended on it. | As the brief says: the tier does not count (`tierSelected` is not called). The counter keeps its value, and a due turn does not go before the tier. | Brief |
| Wait for quiet. The probe passed `backlog: true` to `quietHolds`, so its B would have been held after a backlog cancel. No probe plan started a wait for quiet. | As the spec says: a promoted file is not held. `quietHolds` gets `backlog && promoted === null`. Test: "a wait for quiet after its cancel does not hold the next promoted-only tier". | Spec C4 step 5 (row 011-82) |
| The probe filtered the order to promoted files when `hasRecent()` was false over every lane. | The same reading over the free lanes, as the rest of `selectTier` reads them. One lane: no difference. | Worker |
| The standing a promoted-only tier shows while an edit's work waits. | `named`. A wait's line then says "the tier does not yield: it runs a file this wait or an earlier one selected". Every file of the tier was promoted. No new standing kind, so no type change in `src/core/types/standing.ts`. | Worker |

## 4. Consequences and limits

- The slow tier. `Scheduler.#editPending` holds a slow file while promoted files are queued (C15 "Older daemons"), and while an edit's tier is in flight. A promoted-only tier in flight is a backlog tier there, so a slow file may start beside it. Today's edit tiers of promoted files held the slow tier until they ended. `scheduler.ts` is not this row's, so this is unchanged.
- Starving the backlog. A stream of named waits with no edit can now hold the backlog: the turn does not come between promoted-only tiers. Each such tier is bounded by the wall budget, and each wait by its deadline. The research measured that the backlog ended sooner under B (658 s against 1,312 s), because the promoted files run wide.
- The yield to a later wait (research F3, F5) is unchanged. A wide tier can still be cut by a later wait for other files once the earlier wait has ended. Option C was not taken.
- Not measured: real parity durations when 22 to 33 of them run at once (research, Open questions).

## 5. Tests

New:

- `test/scheduler/promoted-tier.test.ts` (catch-up fixture, real store and pool): one wide tier of 56 at the grant; edit tiers of `runner.tierSize` with an edit's work queued; (a) an edit's work waits for the tier and its file starts in the next tier; (b) an edit of an input of every file cancels it; a wait for quiet after its cancel does not hold the next promoted-only tier.
- `test/scheduler/promoted-tier-select.test.ts` (`selectTier` on a `Ledger`): a backlog tier of promoted files only, then the backlog; with some promoted files claimed by another worktree, the free ones form the tier, and with none free the selection is as before; it does not count toward the turn, and the turn does not go before it; an edit's work keeps tiers of `runner.tierSize`; a slot lane keeps an edit's tier.

Setup changes in existing tests:

- `test/scheduler/catch-up-quiet-select.test.ts`, "takes an edit's file and a promoted catch-up file at once". After the edit's tier, one promoted catch-up file is left and no edit's work is queued. Its tier's kind was `edit` and is now `backlog`, and it holds that file only. The test's point stands: the catch-up wait does not hold a promoted file.
- `test/scheduler/catch-up-order.test.ts`, "6. a queued catch-up file moves to the first group, when a named wait promotes it". The promoted file still leads the next tier and the catch-up tier is not cancelled. With no edit's work queued, that tier is now a promoted-only tier with a grant: `next.workers` was `undefined` (an edit's tier) and is now defined, and the tier holds that file only.
- `test/scheduler/tier-yields-next-tier.test.ts`: the opening comment states the amended time rule (review `reviews/0.1.375.md` N1). No code changed.

## 6. Type changes

All additive:

- `Tier.promoted?: boolean`.
- `startTier(context, ledger, picked, kind, lease?, promoted = false)`.
- `selectTier(context, ledger, busy?, cut?, turnDue?, wide = true)`.
- New export `promotedOnly(context, ledger, free)` in `src/core/scheduler/promoted-tier.ts`.

## 7. Checks

At `b747928ab`, 2026-10-29:

- `pnpm run lint`: "Checked 2552 files ... No fixes applied."
- `pnpm run typecheck`: no errors.
- Squeal, `squeal status --wait 60000`: all 1,319 test files current; 11,591 checks passed, 17 skipped. Four known failures, all bundle drift, which the coordinator's build fixes: `test/harness/plugin.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/codex/packaging/runtime.test.ts` ("cli/squeal.mjs differs from the build").
- The discriminating check for the edit rule: with the `#decide` line for `Tier.promoted` removed, "an edit's work waits for it to end" failed (`cancelled` true). The line was then restored.

## 8. Repair R1 (review `reviews/0.1.377.md` B1, S1)

Worker b663d18b, 2026-10-29. Brief: `tasks/wave-58.5.md` R1.

### The defect

`waitedFor` returned `edit` before it read promoted or focused demand, and `#decide` turned that into `named` for every tier with `Tier.promoted`. So a queued edit hid a later wait's yield, and the tier stood `named` after its promotion had ended, when no open wait had selected any of its files. The flag `Tier.promoted` says how the tier was chosen, not that a wait is still open.

### The rule (coordinator, brief R1)

The exemption's reason, "the cut files would go back promoted and run first", holds only while an unfinished file of the tier has an open promotion (`Beat.files` rank not `null`; `selected` in `yields.ts`).

1. While that holds, queued edit work is not `edit` in `waitedFor`. The promoted, focused and runner checks run as for any tier. With nothing else counting, the result is `named`. The override in `#decide` is gone.
2. With no such file, the tier is a backlog tier as any. `cancelsBacklog` gets `selected` and exempts a promoted-only tier only when it is true, so an edit's work cancels it.
3. While that holds and something waits for the tier, `boundOf` takes the earlier of the decision's own bound and `Beat.until`. So the tier is decided again when its files' promotion reaches its deadline, at each deadline in turn until none is open. For `named` that was already the bound. For `remainder`, `overrun`, `cut` and `recheck` it is new.
4. A promoted-only tier has its rank to beat (`rankToBeat`, row 011-184) from its start, not only once it has run 30 s (coordinator, reply to request `8b69856d`, below). So a queued promoted file of the same or a later open wait never cuts it; it counts once that wait's promotion has ended. `Beat.until` is then the deadline of the promotion that gives the least rank, as for any tier past 30 s. A file X counts only when it ranks before every ranked file of the tier, so no file of the tier goes ahead of X in `startsSooner`, and the decision changes only when that least rank changes: at that deadline, or when a file ends (`standsNamed`).

### Spec sentences to change

C4 step 5, the paragraph of row 011-265. Replace "Only the revisions that changed an input of every file of it that has not ended cancel it. Work an edit caused does not cancel it or make it yield: the cut files would go back promoted, rank before that work and run in tiers of `runner.tierSize`, so the edit's file would start no sooner." with:

> While a file of it that has not ended has an open promotion, only the revisions that changed an input of every such file cancel it, and work an edit caused does not cancel it or make it yield: the cut files would go back promoted, rank before that work and run in tiers of `runner.tierSize`, so the edit's file would start no sooner. A promoted file, a focused entry or a runner part that waits for the run still makes it yield as below; with none of them, the wait's line names the reason (`named`). The tier is decided again at the deadline of that promotion. With none open, it is a backlog tier as any. (Amended 2026-10-29, review `reviews/0.1.377.md` B1: an edit's work hid a later wait's yield, and the tier stood `named` after its wait had ended.)

C4 step 5, the yield rule. In the inserted text "and, for work an edit caused, a tier of promoted files only (above)", replace "a tier of promoted files only (above)" with:

> a tier of promoted files only while a file of it has an open promotion (above)

C4 step 5, the backlog cancel. In ", other than a tier of promoted files only,", replace with:

> , other than a tier of promoted files only while a file of it that has not ended has an open promotion,

C4 step 5, the rank to beat (rule 4). In "A promoted file makes a tier that has run 30 s or more yield only when it ranks before every file of the tier that has not ended (C15's rank: ...)", insert after "a tier that has run 30 s or more":

> , or a tier of promoted files only at any time,

and append after the sentence that ends "...the cut would delay it by up to the time that file had run.":

> A tier of promoted files only has this rule from its start: a cut of files its wait selected delays that wait's verdict and loses their run. (Amended 2026-10-29, the coordinator, request `8b69856d`, review `reviews/0.1.377.md` S1: at 4 pool slots the tier held 12 of 56 promoted files; a queued file of the same wait tied with them on rank, class and duration, so the cut started it first, 12 files ran again after the other 44, and the edit's file started in the 18th tier after it instead of the 14th.)

### The next-tier claim (review S1)

Section 5 said "the edit's file starts in the next tier". That holds only on this precondition: when the wide tier ends, no promoted file that ranks before the edit's file is left queued, no backlog turn is due, and no queued promoted file made the tier yield first. At 24 slots the tier holds all 56 files of P, so the precondition holds. At 4 slots it does not. The tier takes 12 of P within the wall budget at a grant of 4. The 44 left rank before E (C15 Rank) and run in edit tiers of `runner.tierSize`, and the backlog's turn comes after each four of them.

Rules 1 and 4 together keep the edit from cutting the tier at 4 slots. With rule 1 alone, the edit no longer counted, so its check ran the promoted checks. P012 is queued, from the same wait as the tier's files, and ties with them on C15's rank, C4's class and the last-known duration. Before 30 s, row 011-263 puts a queued promoted file first on such a tie, so the cut started it sooner, and the tier yielded once (probe: `last.to` was `promoted`, 12 files cut). The 12 cut files ran again after the other 44, and E started in the 18th tier after the wide tier. By reading the code, `db838e714` makes the same cut at any check with no edit's work queued, for example a later wait's promotion. With rule 4, P012 ranks with the tier's files and does not count: no cut, and E starts in the 14th tier, as on `db838e714` (the review's index 13). Test: `promoted-tier-expiry.test.ts`, the S1 case.

### `named`'s text

`yieldText` says "it runs a file this wait or an earlier one selected". `waitedFor` now returns `named` only when an unfinished file of the tier has an open promotion. Under rows 011-184 and 011-263, the file that keeps the reader's file from counting ranks with it or before it: the same or an earlier open wait selected it. With no open promotion, `startsSooner` has no file ahead and returns true, and the rank to beat is none, so `named` cannot come up. Rule 4 keeps this: a promoted-only tier stands `named` for a file of the same or a later wait. The text is true in each case I traced, so no standing kind was added and no type changed in `src/core/types/standing.ts`.

### Decisions

| Question | Choice | Who |
| --- | --- | --- |
| What `cancelsBacklog` needs | A trailing parameter `selected = false`. Its condition is `Tier.promoted && selected`, kept in `backlog.ts`. | Worker, on the brief's "pass what it needs" |
| The bound when the tier stands on something other than `named` (rule 3) | The earlier of the decision's bound and `Beat.until`, for any decision but none and `yields`. Test: `promoted-tier-bound.test.ts` (fake timers): standing `remainder` with a 50 s bound, it is cancelled for the edit's work at the promotion's 10 s deadline. With the bound removed, the test failed (`expected undefined to be 'backlog'`). | Worker |
| A claim (`recheck`) together with the held edit | `recheck` stays first, as before. The tier is checked each second and publishes no standing. | Worker |
| S1 at 4 slots: a queued file of the same wait cut the tier on a full tie once the edit no longer counted | Rule 4: a promoted-only tier has its rank to beat from its start. Reason given: the wait returns only when each file it selects is current, so cutting 12 running files of the same wait to start P012 delays that wait's verdict and loses up to 12 × 30 s of runs; the human approved removing interruptions that only lose work (A1, 2026-10-28). Not the edit-rank policy the review deferred. The worker's default had been to keep the cut. | Coordinator, reply to request `8b69856d` |

### Tests

New:

- `test/scheduler/promoted-tier-expiry.test.ts` (catch-up fixture, `ModelClock`, P promoted for 100 ms): B1's paired test, a later wait's B099 cuts the tier after P's promotion ended, with and without an unrelated edit (on `db838e714` the case with the edit stood `named` and ran on); with an edit's work alone, the tier stands `named` and status's running line says so while P's wait is open, then the check at the deadline cancels it with no other event and nothing stands `named`; S1's 4-slot case.
- `test/scheduler/promoted-tier-bound.test.ts` (fake timers, a `Ledger`): rule 3 for a decision other than `named` (an earlier wait's edit file counts, the tier stands `remainder`, and it is cancelled at P's 10 s deadline); rule 4, before 30 s a later wait's file does not cut the tier while P's wait is open and makes it yield at P's deadline; the control, an edit's tier of the same files yields to that file at once (row 011-263 unchanged). With rule 4's condition removed, the rule 4 test and the S1 case failed ("expected true to be false").
- `test/scheduler/promoted-tier-fixture.ts`: the setup of `promoted-tier.test.ts`, moved so both files share it, with the promotion's length, the pool's slots and the wide tier's size as options.

Changed: `promoted-tier.test.ts` uses the fixture. "an edit's work waits for it to end" now also checks the standing `named` while P's wait is open.

### Not in this repair

- `Tier.promoted`'s comment in `src/core/scheduler/tiers.ts` (lines 105 to 109 and 113 to 118) still says "only a revision that supersedes it cancels it, and an edit's work waits for it to end" with no condition. `tiers.ts` is not R1's. The words to add: "while a file of it that has not ended has an open promotion".
- `yields.ts` is about 580 lines, over the styleguide's 300. It was 544 before this repair.
- Review S2 and S3 need policy decisions, as the review says. They are unchanged.
