# Row 011-372: every decision in a step's turn reads the step's one reading

Worker fe5d8433, wave 109 (`tasks/wave-109.md`, W1), 2026-11-16. Evidence: `reviews/0.1.518.md` S1. Builds on row 011-366 (`tasks/011-366/notes.md`), which passed the step's reading to the yield check and the fast plan's queue order. Behaviour preserved; the timing differences are listed below.

## The test

`test/scheduler/step-reading.test.ts` spies on the scheduler's virtual clock. Inside each `StepLive.step` (the synchronous turn, nested steps counted with their outer one) every `now()` moves the clock 7 ms and is named by the first two source frames that took it. The step's own reading is the first. Every later reading must match `OWN_READS`: a tier's start, a row's write, the lock's label, or wake bookkeeping. Anything else is a decision read, and the test expects none.

It replaces row 011-366's forwarding test: a yield check or a plan that read the clock itself would now show as a decision read in the first scenario, which also asserts that a check and a plan ran inside the counted steps.

Three scenarios, each on a prompt virtual clock:

1. An edit after a baseline (two files): the revision's yield check, the plan, the tier's start.
2. Beside a running batch's tier (`heldBatch`): an edit's tier beside the batch, then the batch's end, the beside lane's close and the backlog's tiers.
3. A slow lane (`test/e2e/**` as slow, `quietMs` 0): an edit queues a fast file and two slow files; the lane lists, guards, picks and starts.

Reads inside the counted steps, same final test on the base commit `f75806704` and on this branch (host load 13.5–14.4 on 24 CPUs; counts do not depend on load):

| Scenario | Steps | Reads before | Decision reads before | Reads after | Decision reads after |
|---|---|---|---|---|---|
| 1. Edit | 9 | 22 | 4 | 18 | 0 |
| 2. Beside a batch | 23 | 274 | 180 | 94 | 0 |
| 3. Slow lane | 17 | 58 | 14 | 44 | 0 |

The decision reads before, by site: `RunQueue.#firstGroup` through `hasFirstGroup` in `busyLanes` and admission (138), `startable`'s claim check (23), `besideFiles` (10 from admission's free-lane fact, 4 from the plan's `beside`), adoption's read (8), `Claims.backlogSize` (5), `RunQueue.#ranks` under `orderedBatches` (3), `orderedGroup` (3) and `orderedSlow` (1), `quietLeftMs` (2), `RunQueue.#groupOf` through `isCatchUp` (1).

## Where the reading now goes

Each new `at`/`now` parameter is optional except on the step's ports and the adapter's host, so a caller outside a step reads the clock as before, at the same place.

- `step.ts`: `StepPorts.admit(at)`, `idleLanes(at)`, `slowQueued(lane, at)`, `besideDone(lane, at)`; every rule passes `Turn.at`.
- `step-live.ts`: `StepHost.admit(at)`, `adopt(context, ledger, at)`, `busyLanes(at)`; the plan's `busy` and `beside`, `liveAsks(…, now)`, `startNext`'s `at`, the slow lane view's `admit`, the yield check's adoption and hold read.
- `scheduler.ts`: `#admit(at?)` → `#facts(at?)`: `editQueued`, `fastQueued`, `focused`, `freeLaneQueued`, `holdsFollowers`; `#busyLanes(at?)`, `#freeLaneQueued(at?)`, `#focused(at?)`, `#adopt(…, at?)`.
- `beside.ts`: `besideFiles(…, at)` (was `context.now()` at `:36`) and its `orderedBatches(at)` (was `:51`); `besideDone(…, at)` through `isPromoted(ref, at)`.
- `queue.ts`: `isPromoted`, `isFirstGroup`, `isCatchUp`, `hasFirstGroup`, `orderedSlow`, `orderedGroup`, `tierSelected`, `batchSelected`, `focusedSelected`, `batchStarted` take `now?`; `#firstGroup` and `#groupOf` pass it to `Promotions.rankOf`.
- `ledger.ts`: `fastQueued(where, now?)` and `ordered(turn, now)` (each paused-backlog drain check, `#drains(ref, now)`; `ordered`'s was missed until the repair below), `orderedSlow(now?)`, `orderedGroup(group, now?)`.
- `tier-live.ts`: the view's `isFirstGroup`, `isCatchUp`, `isPromoted`, `hasFirstGroup`, `fastQueued` read `now`; `liveAsks(context, ledger, now?)`: `peek` and `backlogSize`.
- `slots.ts`: `busyLanes(…, at?)`. `focused.ts`: `focusedWaiting(…, at?)`, `startFocusedTier(…, at?)`.
- `claims.ts`: `peekClaim(…, at?)`, `claimOf(…, at?)`, `Claims.backlogSize(queued, at?)`.
- `stored-keys.ts`: `StoredKeys.adopt(…, at?)`: the read's start is the step's reading.
- `slow-release.ts`: `idleLanes(at?)`. `slow-trigger.ts`: `momentHolds(…, at?)`, `quietLeftMs(…, at?)`. `slow-tier.ts`: the listing's order, trigger, claim check and quiet wait, `holdsFollowers(state, at?)`, `#select`'s trigger and `#start`'s claim check read `view.at`.
- `tier-start.ts`: `StartOptions.at`; the act step's count (`tierSelected`, `batchSelected`, `batchStarted`, `focusedSelected`) and `startTier(…, { at })`. `tiers.ts`: `startTier`'s marks take `at`; `startable`'s last claim check reads it.

## Reads that stay in a step's turn, and why

Each is named in the test's `OWN_READS`.

- **The step's reading**: `StepLive.step` (`step-live.ts:133`). The one decision input.
- **Tier start** (an action's timestamp): `newTier`'s `startedAt` (`tiers.ts:238`), the run row's `startedAt` (`tiers.ts:198`), `executeTier`'s start for the run's duration (`tiers.ts:293`), a slow tier's `since` (`slow-tier.ts:672`). These stamp when the tier started, after the decision; the step's reading would date them before the work between.
- **Row write** (a write's timestamp): the ledger's commit (`Ledger.#write`, `ledger.ts:700`, `:711`, `:723`, `:734`), a result's last-used time on a lookup hit (`acceptedAt`, `accept.ts:51`, `:53`; spec 001 D8, the eviction order), the pool wait's row and log line at a grant or refusal (`PoolWaits.granted`/`refused`, `pool-wait.ts:107`, `:123`, reached through `TierCapacity.#told`; `src/core/capacity/` and the pool's interface are out of this row). `movesWouldChange` at `:711` decides only whether a quiet commit writes, inside the write.
- **Lock label**: `Mutex.relabel` (`mutex.ts:59`), when the turn's current operation began, for the lock watcher (row 011-302). Bookkeeping of the lock, not a scheduling decision.
- **Wake bookkeeping**: the wake loop's arm (`Wakes.#reading`, `#steadyNow`, `wakes.ts:250`, `:258`; row 011-369 owns `wakes.ts`), the runner part's bound arm during a drain (`RunnerPartBound`, `runner-work-bound.ts:75`), the slow release's arm after a lane answers (`SlowRelease.arm` → `#decide`, `slow-release.ts:138`).

## Reads the scenarios do not reach in a step's turn

From a source sweep of `now()` under `src/core/scheduler/`; none is a decision inside a step's turn:

- The yield path: `decide-yields.ts:146` gives its helpers a context whose `now` is the step's reading, so `yield-waits.ts:87`, `:152`, `:191`, `readClaim` (`claims.ts:196`), `readFocused` (`focused.ts:75`) and `decide-yields.ts:259` read it.
- Fallbacks taken only without a reading: `Claims.holds`/`#live`, `peekClaim`, `claimOf`, `focusedWaiting`, `Promotions.rankOf` (`:149`), `RunQueue.#ranks` (`queue.ts`), `liveView` (`tier-live.ts:43`), `StoredKeys.adopt`, `momentHolds`/`quietLeftMs`, `SlowRelease.#decide`, `tier-start.ts:147` (`startedAt` is always set by `newTier`).
- Outside a step: tier ends and records (`tiers.ts:329`, `:442`, `record*.ts`, `focused-record.ts`, `slow-tier.ts:770`, `slow-release.ts:103`), the revision pass and quiet bookkeeping (`quiet.ts:150`, `:168`), request intake (`request-intake-requests.ts`, `covered-files.ts:59`, `promotions.ts:135`), checkpoints, holds (`hold.ts`, `command-hold.ts`), notes and head moves, the wake loop (`wakes.ts:290`).
- `Promotions.#settle` (`promotions.ts:228`), which ends batches past their deadline when the queue changes, and `publishPromotions` (`ledger.ts:200`), its row's write: no step in the three scenarios reached either. A later row could pass the reading to `settle` when a step's write changes the queue.

## Timing differences

- Inside one step every batch rank, claim bound, quiet moment and beside sum reads the same time. Before, a wait whose deadline passed during the turn could rank one file and not the next; a claim's bound or a quiet window could end between two reads of one decision.
- Adoption's next read window starts at the step's reading instead of a later reading in the same turn: it starts earlier by the turn's synchronous work. The overlap (`STORED_KEYS_OVERLAP_MS`) and the seen-key map already cover a window that starts earlier; nothing is read twice as new.
- The slow lane's quiet wait (`#arm(at, quiet)`) counts from the step's reading, as its arm already did.
- No status payload, note text, CLI output or key changed, and no rule changed: the queue's class order, the batch turn, widths and the pool are as before. The rules now read one snapshot of time per step. A decision at an exact threshold (a deadline, a claim bound or a quiet window that ends between the step's reading and a later read in the same turn) now sees the threshold as not yet passed for the whole turn, and the next step sees it passed. That is the intended change; no test pins such a crossing yet (see the repair section, S1).

## Type changes

All additive. Required new parameters only where every caller is in this row: `StepPorts.admit(at)`, `idleLanes(at)`, `slowQueued(lane, at)`, `besideDone(lane, at)`; `StepHost.admit(at)`, `adopt(context, ledger, at)`, `busyLanes(at)`; `besideFiles(…, at)`, `besideDone(…, at)`. Optional elsewhere (listed above). `StartOptions.at?`; `startTier`'s marks gain `at?`. Table ports in `step.test.ts` that ignore the new arguments still compile.

## For the next worker

- The row's done-when holds for these three scenarios; a path they do not reach is covered only by the sweep above. A new decision helper that reads `context.now()` inside a step shows up in this test only if a scenario reaches it: add a scenario, or give the helper the step's reading from the start.
- `OWN_READS` names sites by function name. A rename of `newTier`, `executeTier`, `startTier`, `SlowTier.#select`, `Ledger.#write`, `acceptedAt`, `PoolWaits.granted`/`refused`, `Mutex.relabel`, `Wakes.*`, `RunnerPartBound.*` or `SlowRelease.arm` fails the test with the frames named; update the list, not the source.
- Candidate 0.1.520 (row 011-369) changes `clock.ts`, `wakes.ts`, `options.ts` and two lines of `scheduler.ts`; this row touches none of those lines. `test/helpers/virtual-clock.ts` and `batch-fixture.ts` change there; this test uses `virtualClock` through `catchUpSide(…, { clock: "virtual" })` and `heldBatch({ clock: "virtual" })` only.

## Repair after review 0.1.520

Review `reviews/0.1.520.md` (commit `f6ccb4892`): FAIL, one blocker.

- **B1, fixed.** `Ledger.ordered(turn, now)` passed its reading to the queue's sort but not to the paused backlog's drain filter (`ledger.ts:222`), so `#drains` read each batch rank afresh through `isFirstGroup` → `isPromoted` → `Promotions.rankOf`. The test gains a fourth scenario: the beside-batch scenario with `side.scheduler.pauseBacklog(true)` after `heldBatch` (the two share `besideSteps(paused)`). Before the fix it failed with 46 decision reads, all `Promotions.rankOf < RunQueue.isPromoted`, as the review found; after it, none. Both callers of `#drains` (`ordered`, `fastQueued`) now pass the reading. The drain's rank read is not added to `OWN_READS`.
- **S1, in part.** Done: each scenario now also checks values. Each yield check's sixth argument and each plan's `Ledger.ordered` reading must equal the step's own reading (`expectOneReading`). A count alone does not catch a constant or a wrong reading passed on. Checked: a plan given `now + 1` fails the edit scenario. Not done, left for a follow-up test slice: deterministic threshold cases, with a positive quiet window and another worktree's claim bound that ends just after the step's reading, asserting the step's choice, its next wake and the next step's choice. These need a claim fixture with a second worktree and a quiet-window set-up of their own; they are more than a small addition. The preservation claim above is stated in snapshot terms instead.
- Not changed: `Promotions.#settle` (`promotions.ts:228`) stays a deadline decision outside these scenarios, for a later row, as listed above. The three-plus-one scenarios cover the paths they reach; they do not prove that no other step path reads the clock.

Checks for the repair (host load 65–76 on 24 CPUs throughout): `step-reading.test.ts` red before the fix (1 failed, 3 passed, 16.8 s), green after (4 passed, 11.3 s); lint and typecheck pass.

