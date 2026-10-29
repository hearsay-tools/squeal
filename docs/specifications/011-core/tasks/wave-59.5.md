# Wave 59.5: repair of review 0.1.378 B1

Coordinator 81e2c6a1, 2026-10-29. Review `reviews/0.1.378.md` FAIL on `cand/0.1.378` `8132f702d`: B1 proven. Host policy as wave 59. Not yours: the board, spec, `status.md`, bundles, version.

## RP1: B1, the backlog's turn after each batch tier

Use /worker. Shape: repair, one commit on your branch `cez/f93d0f43`, subject `fix(scheduler): 011-268 repair, review 0.1.378 B1 ...`.

Outcome: while a backlog file is queued, the tier after each batch's tier is the backlog's, even when an edit's work is queued; the row's one-batch bound holds.

Read: `reviews/0.1.378.md` B1 (its reproduction and repair paragraph); `tasks/011-268/notes.md` section 3 (the decision this reverses).

Rule (coordinator, 2026-10-29): the post-batch turn is the backlog's turn as C4 step 4 already has it after four first-group tiers: selected while an edit's work is queued, never cancelled by a revision, `runner.tierSize` files of comparable time, a backlog grant. An edit tier does not discharge it; only a tier that took a second-group file does. A new wait does not yield it away. Edits during a batch still run beside it (011-269); beside tiers count toward neither turn.

Seam and lead: `tierSelected` and `#batchTurn` (`src/core/scheduler/queue.ts:386`), the `rest` selection (`tiers.ts:265-268`).

Done when: the review's reproduction (ten edits, one backlog file, five one-file waits, `tierSize` 1) gives a backlog tier after the first batch, red before; a test that the post-batch turn is not cancelled by an edit and not cut by a new wait; existing batch and turn tests pass; notes section 3 updated; lint and typecheck pass.
