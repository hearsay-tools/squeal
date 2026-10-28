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
