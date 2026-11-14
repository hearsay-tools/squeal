# Tier plan: decide which tier starts next, then start it

Design brief from the architecture review of 2026-11-12 (Cezar task af6c0b3f, report artifact d8b46fe2, card 6). Rechecked on main at `752313729` on 2026-11-14 by design session baf61c5d. Terms: `GLOSSARY.md` (Tier, Tier plan, Queue view, Yield, Admission, Lane, Runner traits). The decisions below are the human's, taken one at a time on 2026-11-14. Rows 011-346 to 011-349.

## Problem

`selectTier` (`src/core/scheduler/tiers.ts:260-497`, 237 lines of an 867-line file) picks the next fast tier. It writes while it decides, and it calls itself again when its first choice fails (read in source code at `752313729`):

- six positional parameters: `(context, ledger, busy, cut, turnDue, pass)`, with a `SelectPass` of four flags (`wide`, `rest`, `beside`, `asEdit`);
- 6 self-calls (5 on 2026-11-04):

  | Line | When | What it does |
  |---|---|---|
  | 284 | after a batch's tier | the backlog's turn of second-group files first (`rest`); none, go on |
  | 418 | a due turn started no second-group file and focused entries wait | again without the turn, so focused goes first |
  | 423 (via 435, 461) | the batch's grant was refused or narrower than an edit's tier (`narrowerThanEdit`) | the batch again as an edit's tier (`asEdit`) |
  | 440 | the turn's tier was refused by the pool | the edit's tier first, the turn after it |
  | 491 | a batch picked nothing, each file waiting on another worktree's claim | the rest of the queue (`wide: false`) |
  | 496 | a lookup in `startTier` settled a pick, or only slot files are left | again |

- writes in the middle of the decision: `ledger.claims.begin()`, `ledger.queue.remove` and `touch`, `ledger.applyResults` inside the pick loop, `ledger.commit()` at 4 sites, the pool's `take` and `lease.release()`, `startTier`;
- why nothing started lives in flags set on the way (`Claims.#waiting`, `TierCapacity.#refused`); the pump computes the quiet wait again itself;
- the pump has two more retry paths around it: `#besideTier` (`scheduler.ts` ~1310) and the loop that fills slots (~1119).

Around it: `RunQueue` (`queue.ts`) has 45 methods; `SchedulerContext` (`context.ts`) has 21 fields and is used by 50 source files. `TierYields` (`yields.ts`, 548 lines) decides whether a running tier yields. Its "would the waiting file start sooner" check, `startsSooner` (`yield-sooner.ts`, 110 lines), is a second model of the order in which queued files become tiers (`87b8069ea`). The two models disagreed once (`6c6a88d4f`).

**Lookups write.** `ledger.probe(key)` updates the stored result's `last_used_at`, may copy the newest result set to the key (`copyNewest`), and reads the clock. `Claims.holds` and `backlogSize` read the store; the pool's `offer` reads permit files and `/proc`. Selection asks these lazily, in queue order, and stops at the tier's size. `startTier` probes again inside `BEGIN IMMEDIATE` (`startable`) to close the race with other worktrees.

**Defects by cause** (read in the review files and `git log`; mechanism inferred):

| | Since 2026-10-20 | Since 2026-11-04 |
|---|---|---|
| Review blockers in selection and yields | 12 | 2 (`reviews/0.1.413.md` B1, B2) |
| Fix commits | 17 | 1 (`7b9709fca`) |
| All commits on the tier files | 76 | 10 (4 since 2026-11-08, none a fix) |

The 12 blockers by mechanism: 4 the order between kinds of tier (wave-4 S2-B2, 0.1.280 B2, 0.1.377 B1, and 0.1.378 B1 in part); 4 a yield on wrong evidence or with no recheck signal (0.1.237 B1, B2, 0.1.271 B1, 0.1.296 B1); 2 clock readings (0.1.296 B2, 0.1.296-r2 B2, fixed by `b96343e1d` and `441de0b00`); 1 grant arithmetic after a trim (0.1.413 B1: the reviewer asked to "determine the edit-sized batch candidate and its width independently of the pool-budgeted wide pick"; the repair added a `trimmed` flag); 1 a skipped write on one path (0.1.413 B2). Four more blockers are in `tiers.ts` but in recording (card 1's scope).

The plan and apply split plausibly prevents about 4 of the 12, two of them in part (0.1.413 B1 and B2, 0.1.378 B1, 0.1.280 B2). It would not have caught the order rules or the yield evidence: those need explicit rules and tests whatever the structure. Most self-calls are where fixes were added (`5229dcecf`, `9a695ee18`, `a6366baee`, `7b9709fca`), not where defects started. Spec 016 `research/core-defects.md` filed most selection and yield items under "named demand" (22 items, 14 blockers); its proposed state-machine test does not exist.

The defect count alone is small now. The card's value is a base for card 7 (the scheduler's decisions as one step) and tests that need no stub of the daemon.

**Tests** (counted file by file; the review estimated 30 to 40 files):

- 7 test files call `selectTier` directly, each with a hand-built `SchedulerContext` cast `as unknown as SchedulerContext` and a real `Ledger` over a fresh store; the stub is copied 9 times. 36 cases: about 20 are plan decisions, 6 are grant, trim and refusal cases, 10 test something else.
- 28 test files cast a `SchedulerContext` by hand; 19 of them test recording, keys or the ledger, not selection.
- 18 `tier-yields-*` files: 13 drive the whole scheduler. About 41 yield cases could be table rows; that is not this card (decision 2).
- `yield-sooner.test.ts` (7 cases) is already pure: the target shape.

## Decisions (the human, 2026-11-14)

1. **Scope: decide, then act** ("Card 6: A: decide, then act"). A decision step returns the tiers it would start, in order, each with its files, width and reason, and writes nothing. A small act step takes the CPU grant and starts the first; a refusal takes the next candidate instead of a self-call. A move row that changes nothing a user sees comes first; a real bug the move finds gets its own row with a failing test first.
   - Rejected: remove only the self-calls, with lookups and writes inline (card 7 would pull the decision out later); stop the card (the defect rate fell to 2 blockers in 10 days).
2. **Yields: one owner of the order** ("Give way: B: shared order", after the human asked which option generalizes the building blocks best). `TierYields` stays as it is. Its "would the waiting file start sooner" check asks the tier plan over a queue view of the queue after the yield, and `startsSooner`'s own model goes. The tier plan takes the queue as a value (a queue view), so the live queue and a queue that does not exist yet are two real uses of one interface.
   - To keep today's answers, the yield passes a view of the cut files and the waiting file only, with no saved result, no claim and no pool, as `startsSooner` models it today. A view of the whole live queue would be more accurate (batches, quiet, other waiting files), but it changes when tiers yield: a later rule change, asked of the human separately.
   - Rejected: yields out, left to card 7 (two models of the order stay); yields in as a decision step plus an act step now (it is card 7's shape, events and one clock reading in, decisions and the next wake out, and the 4 yield blockers were about which events reach it).
3. **Shape: a lazy plan that asks as it goes** ("Shape: X: asks as it goes"). Four interfaces were designed in parallel (design-it-twice, 2026-11-14): minimal (3 entry points over an eager snapshot), flexible (one plan for every ordering question), common caller (the pump and card 7), ports and adapters. Three converged on the chosen shape:
   - the plan asks its three questions (a saved result, a claim, the pool's offer) through one small interface, in today's order, stopping where today's code stops;
   - in the daemon the interface does today's lookups with today's writes; in tests and for the yield check it is a table in memory;
   - the act step takes the grant, trims, starts; a refusal takes the next candidate;
   - when nothing starts, the plan returns the one reason and when to look again.
   - Rejected: read everything first, then decide (the minimal design). It is pure now, but it reads about twice the lookups per decision (estimate, not measured), needs a read-only copy of `copyNewest`, and replays the lookups with a compare-and-redecide path, new code where the costliest past defects were (order and races between worktrees).

## Coordinator's calls (repo-local; the human may overturn)

- **Location.** `src/core/scheduler/tier-plan.ts`: the plan, its candidate and idle types, the queue view type and the ports. The act step beside `startTier`, in `tiers.ts` or a new `tier-start.ts`. One entry file each, no barrel (row 015-110).
- **The interface** (from the common-caller design, with the flexible design's beside and slot stages):
  - `planTiers(view: QueueView, asks: PlanAsks): TierPlan`.
  - `QueueView`: one clock reading `now`, the admission turn, the busy lanes and the tiers in flight, the cut marks (`CutFiles`), `turnDue`, the runner policy and traits, the queue's reads (`ordered`, `orderedBatches`, `rankAt`, the per-file flags, `focused.waiting`), `file(ref)`, the quiet state and the checkpoints. Read-only. A live adapter over the ledger; a table adapter built from rows.
  - `PlanAsks`: `lookup(ref, key)` answering settled or `{ mayWait }`, `held(key)`, `sharers()`, `offer(size, kind)`, and `endPass()` where `selectTier` commits today. The live adapter probes, applies a hit, drops an unkeyed or blocked file and commits exactly as today; the table adapter answers from a map and logs the calls.
  - `TierPlan`: `first` and `afterRefusal()`, each a `Candidate` or an `Idle`. Single use, in one lock turn; `afterRefusal()` after a start throws.
  - `Candidate`: reason (`focused`, `turn-after-batch`, `batch`, `batch-as-edit`, `turn`, `edit`, `backlog`, `slot`, `beside`, `after-claims`), `TierKind`, lane, files (never empty, one lane, within size and each `tierCap`), focus entries, width (`null` for no grant, `"slot"`, or a grant ask with `want`, `least`, `offer`, pool kind, whether a refusal holds the lane, and a pure `atGrant(grant)` giving the prefix that fits and whether it is narrower than an edit's tier), marks (`promoted`, `beside`), what it counts toward (`batch`, the turn, none), and its estimated duration (`wallEstimate` at its width; decision 2 needs it).
  - `Idle`: `claims` (with its wake time, and woken by a store move), `quiet` (its wake time), `pool` (returned by the act step), `nothing-queued` or `lane-busy`. When several hold, the first in the pump's order; the wake time is the earliest.
  - The act step: `startNext(context, ledger, plan): { tier } | { idle }`. It takes the grant, applies `atGrant`, returns an inadequate lease, starts through `startTier` (its re-probe in `BEGIN IMMEDIATE` unchanged) or the focused start, counts the tier (`batchStarted`, `tierSelected`), and on `startTier`'s `null` (a pick settled meanwhile) plans again in the same lock turn. Every lease is released in `finally` until the tier owns it.
- **The six self-calls** become candidates or plan-internal passes: 284 `turn-after-batch` first; 418 an internal pass that commits and moves to `focused`; 423/435/461 `afterRefusal()` gives `batch-as-edit` (refused, or `atGrant().narrower`); 440 `afterRefusal()` on a turn gives the edit's tier, the turn stays due; 491 an internal pass, `after-claims`; 496 settled re-plans in the act step, slots are an internal `slot` candidate. `#besideTier` becomes the plan's `beside` stage and the pump's slot loop its `slot` candidates.
- **The pump** reads `Idle` for its claim, quiet and pool wakes. `claims.waiting` and `capacity.refused()` stay where slow lanes, lint parts and local permits read them. The quiet wake is computed from the plan's clock reading instead of a later one: a difference of milliseconds, named in the notes.
- **Admission.** The pump plans only after `admit()`'s `fast` answer lets it, in the same lock turn, and `startNext` checks the plan's turn (`checkTurn`) as `#fly` does. For the fast lanes admission's width is always "wide" today (`tests` is a `normal` group); the view carries it, and nothing re-checks the start facts.
- **Runner traits** (card 8): the plan reads `tierWidth`, `tierPart`, `backlogSlot` and `lane` through the view; it restates no default.
- **One clock reading.** In 011-346 the plan passes `now` wherever a parameter already takes it (`holds`, quiet, `focused.waiting`, `rankAt`). The queue's own ordering still reads the clock per promoted entry (`Promotions.rankOf`, `promotions.ts:145`, `queue.ts:548-563`); 011-347 changes that.
- **011-346 preserves today's behaviour exactly:** the same tiers, in the same order, at the same widths, with the same lookups, writes and commits in the same transactions. `selectTier` stays as a thin wrapper over `startNext(planTiers(...))`, so the 7 test files that call it check the move unchanged. A path whose order the plan cannot hold without a change is reported in the notes before it is changed.
- **Tests: replace, don't layer.**
  - **New plan table** (`test/scheduler/tier-plan.test.ts`): a `view(rows)` builder and the table asks, no store, no scheduler, no timer. Rows: each candidate reason and their order; each of the six former self-calls; 0.1.413 B1's six 500 s files at a grant of 3 (expect `batch-as-edit`); quiet holds; slot skipping; `joinSpan` and cut marks; `tierCap`; claims and the claim wait; lazy lookups (the call log stops at the tier's size); each `Idle` reason and its wake time.
  - **New act tests** with a fake pool: grant, trim at a lower grant, narrower than an edit's, refusal to the next candidate, a lease released on a throw, a settled pick re-planned.
  - **Moved in 011-349:** the plan and act cases of the 7 `selectTier` test files. `batch-select`, `focused-group-turn` and `promoted-tier-select` go whole; `backlog-quiet-select`, `catch-up-quiet-select`, `batch-busy-host` and `pool-wait` keep only their cases about quiet state, publishing and `PoolWaits`. The worker names each case.
  - **Stay:** every test that drives a real scheduler through a wait or a race (`catch-up-*`, `group-lanes-*`, `slots`, `batch-tier`, `backlog-*`, `edit-cut*`, `promoted-tier*`, `promotion-cut`, `handover-batches`), and the `tier-yields-*` files. They prove that nothing a user sees changed. The worker lists the cases the plan table repeats; removing them is a later quality row.
  - The 19 hand-built contexts outside selection are not this card's; narrowing their parameters is a later quality row.
- **Key format.** Unchanged. The plan decides which files start, never a key. `test/keys/validity/` reaches `ledger.ts`, `queue.ts`, `claims.ts` and `promotions.ts` at run time, `tiers.ts` and `yields.ts` only through types: 011-346 and 011-347 re-read `compare.test.ts` and `reach.test.ts` and pass `test/keys/key-format.test.ts` without a version raise.

**Amended 2026-11-14 (row 011-346, `reviews/0.1.507.md`; `status.md`):** the plan spans seven files; `TierPlan` adds `afterUnstarted` and `afterStart`; `Idle.wakeAt` is the chosen reason's own wake, not the earliest; `PlanAsks` has more asks (each a write or read the table must control); a slot is a grant ask of 1; the pump keeps reading `claims.waiting` and `capacity.refused()` beside `Idle` for the slow lanes; the quiet sleep counts from the plan's clock reading (review N2). Row 011-348 (`reviews/0.1.510.md` N2): the yield check sums each tier's longest file duration, as `startsSooner` did, not `Candidate.estimateMs`, which is never below it and would change answers.

## Not in scope

- What a running tier's yield decides, its events, timers and status record: card 7. Only its "starts sooner" check moves (decision 2).
- A yield over the whole live queue: a later rule change, asked of the human.
- Recording a finished tier (`recordTier`, `record-tier.ts`): card 1.
- Whether a lane may start, and the slow lanes' width: card 5's admission.
- The order in which the pump asks the lanes, and every scheduler decision as one step: card 7, which composes `admit` and `planTiers`. To be pure, card 7 turns each of the plan's asks into a question its step returns.
- `RunQueue`'s width (45 methods). The plan reads through `QueueView`; shrinking `RunQueue` is a later quality row.
- The remote lane and spec 021 D18's per-machine budget: card 10, after spec 021's measurement on 2026-11-19. `executeTier`'s `background` and `TierPermits` do not change.

## Rows (spec 011; approved by the human, 2026-11-14, "Rows: Approve, land, start")

1. **011-346, the tier plan and its act step, behaviour preserved.** Done when:
   - `planTiers`, `QueueView`, `PlanAsks`, `Candidate`, `Idle` and `startNext` exist as above; `selectTier` is a wrapper over them and has no self-call; `SelectPass` is not exported;
   - the plan writes nothing except through `PlanAsks`, whose live adapter writes at today's points (the notes list each write and its transaction);
   - `#besideTier` and the pump's slot loop are gone; the pump's claim, quiet and pool wakes read `Idle`;
   - the plan table and the act tests pass; the 7 `selectTier` test files and every scheduler test pass unchanged;
   - no tier, order, width, status payload, note text, CLI output or key changes; `test/keys/key-format.test.ts` passes without a version raise.
2. **011-347, one clock reading orders the queue.** After 011-346. A test first: a promotion that expires between two of the queue's clock readings in one decision. `rankAt`, `ordered` and `orderedBatches` take the plan's `now`. Done when the test passes (or the notes show it cannot fail today and the table pins it), and `compare.test.ts`, `reach.test.ts` and `key-format.test.ts` pass without a version raise.
3. **011-348, a yield asks the tier plan whether the waiting file starts sooner.** After 011-346. A test first: `startsSooner` and the plan over the yield's view (the cut files and the waiting file, no saved result, no claim, no pool) give the same answer on every case of `yield-sooner.test.ts` and `tier-yields-next-tier.test.ts`. If they differ, the difference is a bug and gets its own row with a failing test. Done when `yield-sooner.ts` is gone, `TierYields` asks the plan, `yield-sooner.test.ts` becomes rows of the plan table or of a yield-check table, and every `tier-yields-*` test passes unchanged.
4. **011-349, the old entry point goes.** After 011-346. Done when `selectTier` is gone, the plan and act cases of the 7 test files have moved to the plan table and the act tests (each named in the notes), and the files listed above are deleted or reduced to the cases that stay.

## Process

This is product code in `src/`. A coordinator for spec 011 runs the rows. Each candidate needs a passing review before main (`docs/process.md` steps 5 and 6).
- 011-346 first, one worker, `claude` `opus` at high effort.
- 011-347, 011-348 and 011-349 after it lands, `claude` `opus` at medium effort. 011-347 edits `queue.ts`, `promotions.ts` and the plan's view; 011-348 edits `yields.ts`, `yield-sooner.ts` and the plan's estimate; 011-349 edits `tiers.ts` and tests. The coordinator checks their files for overlap before running them side by side; 011-347 and 011-349 may share a worker.
- Reviewers run `codex` `gpt-6.1-sol` `high` (the human, 2026-11-14).

Collisions:
- **Card 7** follows in `scheduler.ts` and `tiers.ts` and starts after these rows land.
- **The waits lane** (coordinator cdd216e5) finished 011-344 and 011-345 in slow-lane files (`slow.ts`, `groups.ts`); these rows do not edit them. Told before dispatch.
- **Spec 021** (the remote lane, card 10) reads `executeTier`'s `background` and `TierPermits`; these rows leave them as they are.
- Row 011-301 (a flaky `tier-yields-kept.test.ts`) is proposed and open; 011-348 does not change that file.
