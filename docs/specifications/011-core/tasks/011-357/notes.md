# Row 011-357: the slow lanes decide inside the step

Worker 5403a8d0, wave 102 (`tasks/wave-102.md`, W1), 2026-11-15. Design: `research/scheduler-step.md`, decision 4, "011-357 drops", the lock watcher paragraph of "The step's interface", row 7. Baseline: cand/0.1.515 (`8c0a6c91e`, row 011-356) plus the wave-102 brief (`82309c087`).

## What changed

- `slow-tier.ts`: `SlowTier.decide(view, fly)` replaces the async `next(launch)`. It runs in the step's lock turn: the listing (`#candidates`), the load guard with its budget (`#guardOf`, `#guard`), the slot (`#takeSlot`) and the pick and start (`#launch`, `#select`), in one synchronous piece, on the disk facts the step read just before its turn. It answers from a closed list, `LaneDecision`: `started`, `again` (the queue moved under the pick), `deferred` (the load guard holds it), `none`. Its time is the step's one reading (`view.at`). A lane gets the scheduler's state only through what a call passes it (`LaneState`, `LaneEnd`, `LaneView`); what it is made with is `LaneLoop` (its wake, the clock for a preempt, the store it publishes to).
- `step.ts`: `askSlowLanes` asks each lane admission's `ask` lists, in that order, through the port `askLane(group, at, fly)`. `started` or `again` ends the rule with `again`; `deferred` and `none` go on to the next lane. A lane's run is a `start-tier` decision with `slow` (its run and slot), carried in the turn as made. The step that reads the re-walk's answer plans nothing and asks no lane (`rewalkRead`), as the step after `ask-lanes` did.
- `step-events.ts`: `ask-lanes` is gone from the closed list and `DECISION_PLACE`; `start-tier` gains `slow?`.
- `scheduler.ts`: the live `askLane` (the lane's `decide`, then `SlowRelease.arm()`); `#fly` gets the slow run from the decision; `commandHold()` no longer closes lanes itself: it preempts (a load guard's wait ends, so that lane is idle), cancels the held tiers and pumps, and the step closes the idle lanes (`closeSlowLanes`, the one rule). `#groupLanesNext`, `#probe` and the `SlowHost` object are gone.
- `slow-release.ts`: `selecting`, `#selecting` and `idle()` are gone; `closeIdle` and `#due` no longer skip during a selection (there is no async selection).
- `group-tiers.ts`: `nudge(ledger)`, `endedOnce(end)`; `lanes` documents that admission's `ask` is the order.
- `mutex.ts` (agreed, reply to request 11f69cb4): `Mutex.relabel(operation)`. While a lane lists, the step's turn reads `listing the queued files of group <g>`; while it guards, takes its slot and picks, `selecting a tier of group <g>`; then `selecting the next tier` again. Each relabel restarts the holder's `since`.

## The grep (done-when)

```
$ grep -rn "#mayStart\|#preemptions\|selecting(\|#selecting\|ask-lanes\|#groupLanesNext\|SlowHost\|LanesRead\|reads?.lanes\|\.next(launch" src/ test/
(nothing; exit 1)
```

`#mayStart`, the preemption counter (`#preemptions`), `SlowRelease.selecting`, the temporary `ask-lanes` decision, `#groupLanesNext` and `SlowHost` are gone. `preempt()` stays: it ends a load guard's wait and takes its time off the budget.

"Close idle slow lanes on a hold" is one rule, `closeSlowLanes` in `step.ts`. The record's three sites at `524c63be3` were `scheduler.ts:677` (`commandHold()`), `1094` and `1124` (the old pump's two, which 011-356 already made the step's rule). `commandHold()` now lets the step decide. `#slowEnded`'s close on a hold stays: it closes the lane of the tier that is ending (still in flight, so never "idle"), not the idle lanes.

The lane order is written once: admission's `ask`, over the start fact `lanes()` (`GroupTiers.lanes`, the policy's order, the default `slow` last).

## The lock turn (the measurement)

Probe: `research/probes/011-357/` (`README.md`). Catch-up fake runner (runs end at once), 4 fast files and 2 files per group, each group at `edit` with `maxParallel` 2 and `deferUnderLoad`, the load read at 0, a private store and slot directory, a scratch `HOME`, 30 rounds of one edit. One run at a time; the one-minute load stated is the host's real load at the run, on 24 CPUs.

`before.txt` was taken before any edit (`82309c087`, load 6.8 to 7.0). The paired runs ran the same probe (with whole-turn totals added) on a detached tree at `37c830c2c` (before) and on this branch at `da601c447` (after), alternately: before 1, after 1, before 2, after 2, at 19:08 UTC, load 7.0 to 11.1.

The turn that starts a slow lane's tier. Before: the lane's own start turn (`selecting a tier of group <g>`: the pick and the start; the guard and the slot ran outside any lock turn). After: the step's whole turn that started it (the lane's listing, guard, slot, pick and start). Median / p95 / max, ms:

| groups | before.txt (load 7.0) | paired before 1 / 2 (load 7.0 to 10.5) | paired after 1 / 2 (load 9.4 to 11.1) |
|---|---|---|---|
| 1 | 2.0 / 2.7 / 3.2 | 3.0 / 4.3 / 6.2; 2.3 / 3.3 / 3.5 | 9.2 / 13.1 / 14.5; 7.7 / 17.4 / 82.4 |
| 3 | 1.8 / 2.5 / 3.6 | 2.0 / 2.9 / 4.2; 2.1 / 3.1 / 3.3 | 10.0 / 14.7 / 20.0; 7.7 / 10.9 / 14.0 |
| 6 | 2.1 / 2.8 / 4.8 | 2.1 / 3.1 / 7.0; 2.2 / 3.1 / 5.7 | 10.0 / 19.7 / 25.7; 7.5 / 10.3 / 12.6 |

The longest lock turn of each run, ms: before 16.5, 12.6 (1 group), 10.9, 11.0 (3), 16.4, 19.8 (6); after 14.5, 82.4 (1; one outlier turn), 20.0, 14.0 (3), 25.7, 13.9 (6). Total lock time per run of 30 rounds, ms: before 871, 689 (1), 999, 1032 (3), 1684, 1735 (6); after 842, 833 (1), 1759, 1350 (3), 3111, 2267 (6): the slot's time is now counted in the lock.

Turns that start no lane tier did not change: a fast tier's start turn 2.2 to 2.9 ms median before and after; an idle iteration's turn that asks the lanes (before: `[ask-lanes]`, after: `[queue-rewalk] +lane`) 0.65 to 0.95 ms median before, 0.65 to 1.1 after.

The cause is the slot: `slot.txt` times `acquireSlowSlot` alone (a private directory, 100 times, load 8.5): one permit 2.5 ms median (p95 2.8), two permits 4.8 ms (p95 5.4). Each permit is a SQLite file written with a full commit. So the step's turn grows by about 2.5 ms for each permit a lane takes when it starts a tier. The default `slow` group has `maxParallel` 4: on an idle machine with 4 or more slow files queued it would add about 10 ms (estimated from that rate, not measured). A group without `maxParallel` takes no slot and does not grow.

The growth is more than a few milliseconds. It went to the coordinator for the human's decision before landing (request of 2026-11-15, 19:12 UTC; options: land as is; make a permit cheaper first in `src/core/slow/slot.ts`, a new row; or take the slot after the turn, which brings back a gap the design rejected). **Decision: pending.**

## Timing differences

1. **The step's turn that starts a slow lane's tier is longer** (above): the guard and the slot, outside any lock turn before, are inside it.
2. **Fewer lock turns per iteration that asks the lanes.** Before: the step's turn, then per lane a listing turn, an async probe and a selecting turn, then a step for the lanes' answer. After: one turn. A lane reads no probe of its own: it decides on the step's probe of the same iteration.
3. **A preemption that arrives during the step's turn is seen at the next step.** Before, a revision, a request or a retry that came between a lane's listing and its pick made the lane plan again (the preemption counter, `#mayStart`). Now there is no such gap: what arrives during the turn runs after it. A retry staged during the turn that starts a lane's tier runs in the lane's next tier, as one staged right after the old selecting turn did (`retry-slow-lane.test.ts`).
4. **One clock reading per lane decision.** The deferral's start, the budget it spends, the recheck's wake and the "slot held for over a minute" note read the step's reading, where they read the clock again (sub-millisecond).
5. **The slow release's wake** re-arms after each lane is asked in the turn (the live `askLane`), where it re-armed at the end of the async selection. A close at the bound or on a hold is no longer held back "during a selection": a selection is one synchronous piece of a turn, so no close can land inside it.
6. **A command hold closes the idle slow lanes through the step.** `commandHold()` resolves after the held tiers' cancel and before the lanes close; the pump's iteration closes them after its install and probe reads (milliseconds). Two edge cases: a stalled pump starts again on the hold (it did on the hold's end already) and ends on the hold's probe; with tiers in flight and no lane that may be asked (`nothingMayStart`), the close waits for the next event, such as a tier's end. A merge hold already closed lanes this way.
7. **The lock watcher's `since`** restarts at each relabel: during a lane, `squeal run <group>` prints how long the lane's part has held the lock, not the whole turn.

## Tests

New and changed rows, `step.test.ts` ("the slow lanes decide in the step's turn (row 011-357)"): lanes asked in admission's order at the step's reading; a lane's run starts in the turn with the iteration's stamp and is carried before the step returns; **a deferred lane does not hold back the next**; every lane deferred or waiting gives the idle answer; `again` plans again and the lanes after it wait; admission leaves out a lane whose tier is in flight; a fast start asks no lane; no lane is asked without current reads or in another lock turn; the step that reads the re-walk's answer plans nothing and asks no lane; a lane's decision that throws. The 011-356 rows of the temporary decision ("no fast tier starts: the slow lanes are asked with the stamp and the plan's idle answer", "a lane that started a run begins the next iteration") are replaced by these; the idle-wake rows now take the plan's idle answer directly; the hold rows also check that no lane is asked; the closed-list row counts 11 kinds. Discrimination: with the rule changed to stop at a deferred lane (temporary edit, reverted), "a deferred lane does not hold back the next" and "every lane deferred or waiting" failed.

`mutex.test.ts` (agreed): a relabel tells a watcher the new text and its start; nothing outside a task. `admission-runner-work.test.ts` also checks that a watcher sees `listing the queued files of group late`, then `selecting a tier of group late`, on a real scheduler.

Deleted rule-only cases of `group-lanes-guards`, `group-lanes-limits` and `slow-tier.test.ts`: **none**. `slow-tier.test.ts` has no fake-host `next` cases at this baseline (all its cases run real Vitest through a scheduler). The cases of the two `group-lanes` files drive a real scheduler, and each also pins a rule of the lane itself (the guard's budget, `maxParallel`, `maxWorkers`, `priority`, `after`, the width), which `step.test.ts` does not cover: the step's table answers through the `askLane` port. Only the step-level part of `group-lanes-guards` case 1 (one group's load wait does not hold back another's) is now also a `step.test.ts` row.

Agreed changes to files outside the brief's list (coordinator replies to requests c69851ef and 11f69cb4), each in its own commit:

- `wake-lane-order.test.ts`: the import and the one cast name `LaneLoop` instead of `SlowHost`. No case changed.
- `slow-release.test.ts`: deleted "keeps the instance through a slow selection, the load guard's wait; past the bound its end closes it" and "the bound passes during a slow selection that starts a tier: nothing closes; the tier's end arms it again" (they called `selecting`); "a hold's close takes every open lane no tier runs in, once" calls `closeIdle(idleLanes())` twice. What covers a slow selection the release bound passes during: there is no async selection left, so no wake can run inside one; the only wait left in a lane is the load guard's, pinned by the scheduler-driven case "the bound passes during the load guard's wait: no close; the tier it starts closes it as its pass drains" (same file, unchanged); and the `step.test.ts` row "a lane's run starts in this turn ..." pins that the start is carried before the step returns.
- `admission-runner-work.test.ts` (row 011-341): "applies runner work queued after the lane's listing before the lane's tier starts" became "applies runner work queued before the step in which the lane would start its tier first": the batch is staged in the step that reads the probe for the lane's step; the batch's runner work now takes 100 ms and logs its end, so a tier that started before the work was applied shows. Discrimination: with the drain rule, the fast answer's runner-work halt and the lane's runner-work refusal all removed (temporary edit, reverted), it failed; with the old assertion (the work's start only) it passed even then, so the old case could not see that.
- `retry-slow-lane.test.ts` (row 011-323): "joins the tier a slow selection in flight starts, not the lane's next planning" became two cases: "joins the tier of the step after its stage" (staged at the step that reads the probe: one tier of both files) and "staged during the step's turn that starts the lane's tier, it runs in the lane's next tier" (staged at the lane's listing text: two tiers).

## Decisions the record did not settle

- **The lane's answers are a closed list** (`LaneDecision`): `started` and `again` end the lane rule with `again`; `deferred` and `none` ask the next lane.
- **A lane's start is a `start-tier` decision with `slow`**, not a new kind, so the model test's per-step check S (a tier starts only on its iteration's reads, never in another turn, never with runner work queued) covers slow starts too.
- **`LaneLoop` keeps what a lane needs outside a step**: its wake (it pumps), the clock (a `preempt` from a revision or request ends a deferral and spends the budget), the store and worktree id (it publishes its activity, also at `retire`). Every read of the scheduler's state is passed with the call.
- **Admission is read fresh at each lane read** (`view.admit()`), as `#admitted` read it, all in the same turn. `#groupLanesNext` read it again per lane because a lane before could have waited; no lane waits now, and the step's earlier rules end it on a halt.
- **The step that reads the re-walk's answer plans nothing.** Without this, the first version asked the lanes twice per idle iteration; a worktree that had just yielded the slot took it back before the waiting worktree's recheck (`slow-slot-fair`, `slow-tier` "hands the slot ..." failed). Fixed in `29a5a31de`, with a `step.test.ts` row.
- **`#slowEnded`'s close on a hold stays** (see the grep section).
- **Relabel's `since`** restarts at each text (the coordinator chose the relabel and the texts).

## Type changes

- `slow-tier.ts`: removed `SlowHost`, `SlowNext`, `SlowTier.next`; added `LaneLoop`, `LaneState`, `LaneEnd`, `LaneView`, `LaneDecision`, `SlowTier.decide`; the constructor takes a `LaneLoop`; `nudge(ledger)`, `holdsFollowers(state)`, `ended(end)`, `endedOnce(end)` take what they read.
- `group-tiers.ts`: `nudge(ledger)`, `endedOnce(end)`.
- `slow-release.ts`: removed `SlowRelease.selecting` and `SlowRelease.idle`.
- `step.ts`: removed `LanesRead` and `Reads.lanes`; added `StepPorts.askLane`; `Decision` is `StepDecision<Tier, SlowRun>`.
- `step-events.ts`: `StepDecision<T, S>` (was `<T, I>`: `I` was the idle answer of `ask-lanes` only, and `step.ts` is the only user); `start-tier` gains `slow?: S`; `ask-lanes` removed.
- `mutex.ts`: added `Mutex.relabel(operation)`.

Not changed: `KEY_FORMAT_VERSION`, any key, tier width, status payload, note text or CLI output; the lock watcher's texts are today's (relabelled inside one turn).

## Checks

To be completed at the end of the row.

## For the next worker

- `src/core/types/scheduler.ts` `StepSeen.reads` still lists `lanes` among the read names in its comment; there is no such read now. Not this row's file.
- `slow-tier.ts` is 904 lines (920 before); `SlowTier.#select` is at complexity 27, as before.
- If the human chooses a cheaper permit, the place is `takePermit` in `src/core/slow/slot.ts` (a SQLite file per permit, written with `BEGIN EXCLUSIVE` and a full commit); `slot.txt`'s probe times it.
