# 011-11 notes: a named wait promotes its test file

Worker notes for the coordinator and whoever continues (2026-10-17). The decisions below were asked and answered by the coordinator during the row; the proposed C15 wording is for the coordinator to amend, not spec text.

## Seam map

- `src/core/scheduler/promotions.ts`: `Promotions`, the named waits' promotions held by a `RunQueue`. Each is `{ files, until, seq }`. It ends at `until` or once none of its files is queued or running. That check runs when a file is queued and when a promotion is added, so the set never outlives its keys by more than the next queueing.
- `src/core/scheduler/queue.ts`: `promote`, `isPromoted`, `isFirstGroup`, `hasFirstGroup`, `setPromotionClock`. In `sorted`, the first-group flag is `recent || promoted`. The next key is the promotion's request order, then C4's classes. `tierSelected` counts promoted entries as first-group ones. `hasRecent` stays edit-only, because it is what cancels a running backlog tier (`backlog.ts`), and promotion never cancels. `isRecent` stays edit-only too, because it is the claim exemption (`claims.ts`, `tiers.ts`, `slow-tier.ts`), and C7 binds a promoted file.
- `src/core/scheduler/ledger.ts`: the queue's promotion clock is `context.now`. "Running" means `file.runningKey !== null`.
- `src/core/scheduler/tiers.ts`: `selectTier` uses `hasFirstGroup` to decide edit tier against backlog tier. A promoted file therefore makes an edit-sized tier (`runner.tierSize`) with the comparable-duration join (001-184). That tier is not cancellable, takes no capacity grant, and counts as `tookBacklog = false`.
- `src/core/scheduler/scheduler.ts`: `Scheduler.promote(testFiles, withinMs)` runs under the lock, then pumps. `#editPending` uses `hasFirstGroup`: **a queued promoted fast file defers the slow tier the way an edit's work does** (the slow-tier effect the coordinator asked to have named here).
- `src/core/types/daemon.ts`: `PromoteRequest { type: "promote", testFiles, withinMs }` and `PromoteResponse`. `src/core/daemon/protocol.ts` parses and validates them. In `handlers.ts`, `HandlerContext.requestPromotion` is optional; a daemon without it answers `this daemon cannot promote`. It is plumbed through `desk.ts`, `desk-messages.ts` and `front-desk.ts` on both threads, then `daemon.ts`'s `#requestPromotion`.
- `src/cli/status-wait-promote.ts`: `promoteNamed` (fire and forget, every failure swallowed) and `ownPathFiles`. In `src/cli/status-wait-paths.ts` the only changes are `NamedWaitOptions.promote` (optional, default `promoteNamed`), the `promoted` flag, the call in the read callback when `ready` and the outcome is still `null`, and the doc paragraph of `waitForNamed`. Nothing that prints changed.

## Decisions (asked, answered by the coordinator 2026-10-17)

1. **When.** Once, at the first read whose selection is decided (`ready`: the sync is at the store's revision and listed, or unsupported past the settle time) while the outcome is still open. A wait settled at that read sends nothing.
2. **Wire.** `withinMs` is what is left of the wait, rounded and floored at 0. The daemon adds it to its own clock, so no clocks are compared across processes.
3. **Lifetime.** A promotion lasts until the deadline, or until none of its files is queued or running. A file waiting on another worktree's claim stays queued here (C4 step 4, "stays queued in its place"), so it is open and the promotion holds through the claim. `RunQueue.clear()` (install, reinstall) drops promotions.
4. **Rank.** A promoted queued fast file counts as first-group work for the tier's size and join, for the four-tier fairness count, and for `#editPending`. It does not cancel a running backlog tier, and it does not exempt the file from a claim.
5. **Paths.** Only test files selected by their own path are sent. Source-path selections send nothing.

## Proposed C15 wording for the amendment

- Lifetime: "Promotion lasts until the wait's deadline, carried as the time left of the wait on the daemon's clock, or until none of the selected files is queued or running, whichever comes first. A file waiting for another worktree's claim of its key is queued, so the promotion holds through the claim. Emptying the queue (an install) drops it."
- When: "The CLI sends the request once, beside the first read whose selection is decided (the daemon's sync pass is stored and the revision listed), and only when the wait is still open then."
- Slow tier: "A promoted fast file queued counts as an edit's work for the slow tier too: the slow tier waits for it as for an edit's."

## Tests

- `test/scheduler/queue-promotion.test.ts` (unit): the order against B, the first group with failing files included, the earlier request first, the deadline, re-queue while open against settled, an unqueued file left alone, the fairness turn after four promoted tiers, the slow class's order, and `clear`.
- `test/scheduler/promotion.test.ts` (issue-14 shape, fake runner): A running, then B and Z queued, gives `[[A],[Z],[B]]` and all pass. Without a promotion the order is `[[A],[B],[Z]]`. A promotion past its deadline orders nothing. A claimed key waits for its claimant and is run once across the two worktrees.
- `test/daemon/promote.test.ts`: parsing and refusals, the handler, and a daemon that cannot promote; the front desk in the worker and on the main thread.
- `test/cli/status-wait-promote.test.ts`: sent once, after the sync and not before, with the time left; a source path promotes only the files named by their own paths; a wait settled at its first decided read sends nothing; `promoteNamed` against a socket; an older daemon's unknown answer and an empty list send nothing and reject nothing.

## Not done here

- Splitting or cancelling a running tier (001-381).
- The named line's reasons and the JSON (011-12). 011-12 can read `RunQueue.isPromoted` for "queued, promoted, behind ...", but that state is in the daemon's memory and not in the store. A status reader that needs it needs a store field or a request, which is 011-12's call.
