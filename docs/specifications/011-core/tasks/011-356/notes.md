# Row 011-356: the scheduler step

Worker 3f053805, wave 101 (`tasks/wave-101.md`, W1), 2026-11-15. Design: `research/scheduler-step.md`, decision 3, "The step's interface", "In-turn triggers", "Tests: replace, don't layer", row 6. Baseline: 011-351 to 011-353 (main) and 011-354/011-355 at cand/0.1.514 `8bf9b4d8d` (the purity repair; the branch was rebased onto it from `896c67ac2`). The row was done whole; no split.

## What changed

- `src/core/scheduler/step.ts` (new): `step(turn): Step`, synchronous, never throws. `Turn` is the one reading `at`, the events since the last step, the `reads` the last step asked for (`null`: a step inside another lock turn) and the ports. `Step` is the decisions in the order made, the next wake, `selected` (the fast start rule ran) and the error of a port that threw. Its body is `RULES`, one line each, in the written order:
  1. `pumpEnded`: the pump's loop ended: its note, then again or rest.
  2. `yieldCheck`: which events reach the check (row 011-354's `yieldReach`); one `check-yields` decision.
  3. `inTurnEnds`: a step inside another lock turn ends here: it never starts a tier.
  4. `stallHolds`: a stall, a stop or a runtime gone ends the pump.
  5. `drainRunnerWork`: queued runner work drains; the pump waits for its end.
  6. `installWait`: an install wait or a reinstall ends the pump.
  7. `nothingMayStart`: at an iteration's first step, no free lane has a file and no lane may be asked (admission's `any`).
  8. `readInstallStamp`: asks for the stamp; a moved install refreshes the keys first.
  9. `probeDiskFacts`: asks for the probe; gone ends, released paths reconcile, a hold holds.
  10. `startFastTier`: admission, then `planTiers` and `startNext`, in this lock turn.
  11. `askSlowLanes`: the temporary async decision until 011-357.
  12. `closeSlowLanes`: on a hold the idle slow lanes close (`decideRelease`'s `idle`) and the pump ends.
  13. `idleAnswer`: claims, quiet, the pool, the re-walk, or the next event.
- `src/core/scheduler/step-events.ts`: the closed list of decisions (`StepDecision`), `DECISION_PLACE` (each kind in the turn or after it; `satisfies Record<StepDecisionKind, DecisionPlace>`, so a kind with no place does not compile), `placeOf`, and the event `pump-ended`.
- `src/core/scheduler/scheduler.ts`:
  - The pump's body: take the reads it carries, run `#step(reads)` under the lock (`#runSliced`, "selecting the next tier"), carry out the decisions placed after the turn (their answers are the next step's reads), stall on the step's error, and wait as the next wake says (`#waitFor`). Its end is a step too (`pump-ended`), outside the lock, as the end was.
  - The live adapter `#ports` (memory and store), `#carry` (decisions in the turn, carried out as the step makes them) and `#carryAfter` (after the turn). Both switches end in `unplaced(decision: never)`.
  - The in-turn triggers: a revision's pass, applied runner work and a request taken call `#stepInTurn` with no reads. A file's end and the yield bound queue one step in a lock turn of its own (`#stepQueued`, "checking the tiers in flight", one queued at a time). A tier started beside the batch's tier reaches the check inside the start rule.
  - Gone: `#cutTiers`, `#checkTiers`, `#recheckTiers`, `#recheck`, `#quietWake`, `#capacityWake`, `#eventOrAfter` (now `#eventOrAt`). `#probe` (the slow lanes' host still calls it) is `#probeRead` then `#reconcileReleased`.
  - `onStep(listener)`: each step as it ends (`StepSeen`).
- `src/core/scheduler/slow-release.ts`: `idleLanes()` (the step's port) and `closeIdle(lanes)` (the `close-lanes` carry-out; nothing closes during a slow selection, as `idle()` did). `idle()` is now `closeIdle(idleLanes())`.
- `src/core/scheduler/yields.ts`: `yieldReach` places `pump-ended` (none). `TierYields` is the candidate's, unchanged.
- `src/core/types/scheduler.ts`: `Scheduler.onStep?` and `StepSeen`.

## The grep (done-when: the pump holds no decision logic)

```
$ grep -rn "#cutTiers\|#recheckTiers\|#checkTiers\|#quietWake\|#capacityWake\|#eventOrAfter" src/
(nothing; exit 1)

$ S=$(grep -n "^  #pump(): void {" src/core/scheduler/scheduler.ts | cut -d: -f1)
$ E=$(awk -v s=$S 'NR>s && /^  }$/ {print NR; exit}' src/core/scheduler/scheduler.ts)
$ sed -n "${S},${E}p" src/core/scheduler/scheduler.ts \
    | grep -nE "admit|#inFlight\.size|idle\.|refused|claims|#probe|#install|#hold|#groups|#slowRelease|#capacity|startNext|#plan|hasWork|halts"
2:    if (this.#admit().halted || !this.#ledger) return;
45:        else if (this.#isIdle()) for (const resolve of this.#idle.splice(0)) resolve();
```

Line 2 is the guard of `#pump()`'s entry: a halted or unstarted scheduler starts no loop (as before; the step itself also ends on a halt). Line 45 resolves `idle()` waiters when the end step said "end" and nothing is pending: rest bookkeeping, not a choice of what runs next. The loop body has no `if` over a fact; its only branches are on the step's answer (`error`, `wake.kind`, `placeOf`).

## Timing differences

1. **More lock turns per iteration.** The reads come from the step that asked for them, so an iteration that starts a tier takes three lock turns labelled "selecting the next tier" (ask the stamp; ask the probe; select), where it took one. An idle iteration adds a fourth after the slow lanes answer, and a fifth after the re-walk's answer. Each is a short synchronous turn. The lock watcher's text for each kind of work is unchanged.
2. **The first decision after an event waits for one lock hop.** The pump used to decide to drain in the event's own continuation, outside the lock. The step decides it in its lock turn. `drain` is placed in the turn, so the drain starts there, not after it (see "Decisions"). `runner-work.test.ts` "closes with runner work queued" pins this: it passes, but only because no extra microtask hop was added. Making `#waitFor` `async`, or awaiting the decisions carried in the turn, made it fail (the close came first and the runner part was dropped).
3. **The quiet wait uses the plan's absolute wake** (`idle.wakeAt`), not `now + (wakeAt - at)`: a difference of the time between the plan's reading and the wait (milliseconds).
4. **The capacity recheck and the claims window count from the step's reading**, not from a reading at the wait.
5. **A file's end is placed when its queued step runs**, not at the end itself. A tier that ended before that turn reaches no check. In practice the queued turn is ahead of the tier's record in the lock's order, so the tier is still in flight.
6. **A file end that reaches nothing still costs one queued lock turn** ("checking the tiers in flight") that decides nothing. Before, `#cutTiers` queued none. At most one such turn is queued at a time.
7. **The probe and the released paths.** The probe read takes the released paths into scheduler memory (`#released`); the `reconcile` decision of the next step reconciles them. A step that ends before the probe rule (a drain, a stall) leaves them for the next probe; none is lost.
8. **On a hold**, the idle slow lanes are decided in the step's turn and closed after it, as before (`#slowRelease.idle()` after the selection turn).

## Decisions the record did not settle

- **The yield check is one decision, `check-yields`, carried out by `TierYields.check` in the turn.** The record lists "stop a tier" and "write the yield row" as step decisions. My first version had them, with `TierYields` split into `decide`/`stopTier`/`apply`. `tier-yields-clock.test.ts` (it drives a real scheduler) spies on `TierYields.prototype.check` and pins its one clock reading and the row's own, so the live path must go through `check`. This also keeps the step independent of `decideYields`' result, which the 0.1.514 repair changed. The step decides whether and after what the check runs; `decideYields` decides the yields; `TierYields` applies them. Coordinator's note on review 0.1.514-r2: the step does not make the yield decision and the claim bookkeeping one read. Both stay inside `TierYields.check`, in the step's lock turn, as on the candidate; the bookkeeping still re-queries the shared claims after `decideYields`.
- **Decisions placed in the turn are carried out as the step makes them** (`StepPorts.carry`). A lane of slots fills every free slot in one turn (task 011-21 slice 2), so the plan must see each started tier in flight. A tier started beside the batch's tier then reaches the yield check in the same rule.
- **Reads span one iteration.** A `reads` wake keeps them for the next step; any other wake clears them. "No tier starts without reads from the current iteration" holds by construction (the start rule is reached only with both reads) and is checked per step by the model test (S).
- **`turn.due` is left out.** A due wake reaches the step as a `wake` event, so a `due` list would repeat the events.
- **The halt check is in "a stall holds", before the drain.** The record's order has "a stall holds; drain runner work; ...; nothing may start". With the halt after the drain, a close made the drain loop: `RunnerWork.drain` returns at once once closed, the work stays queued, and the step decided to drain again. `step.test.ts` pins the order.
- **`drain` is placed in the turn.** It only starts the drain's piece; the drain's tasks take the lock after the turn.
- **No "hold ends" rule, and no rule for the slow release's due close.** The command hold's end stays with its own wake and the public `commandHold()` (the daemon calls it at hold and resume requests). The slow lanes' close at their bound stays with `SlowRelease`'s wake. Routing them through the step needs new lock turns and a new shape for `commandHold()`. Row 011-357 writes "close idle slow lanes on a hold" once (today at the step's `close-lanes`, `commandHold()` and `SlowRelease`'s wake). The decision kinds "cancel the quiet wait", "cancel held tiers" and "end a load deferral" are not in the list yet: no rule of this row makes them.
- **New decision kinds beyond the record's list:** `ask-lanes` (the temporary async decision), `close-lanes`, `tell` (the record's "tell a note": the reinstall or runtime-gone note at the pump's end), `check-yields` (above).
- **The pump's end is a step** (`pump-ended` event, first rule), run outside the lock as the end was. Its note decision is placed in the turn, so the rule reads the admission again after it (a daemon may close on the note), as before.
- **`onStep` is a method of `Scheduler`, not a `SchedulerOptions` field.** The model test builds its scheduler through `catch-up-fixture.ts`, which is not this row's file; a method lets `model-fixture.ts` subscribe without it. Optional, as `watchLock` is.
- **`step.test.ts` is 439 lines**, over the styleguide's about 300. It holds one table. It can be split by rule group if the coordinator wants.

## Tests

- New `test/scheduler/step.test.ts`, a table adapter over the real `admit`: an iteration's reads, then a start; no start without current reads (every partial read set); a step inside another turn starts nothing and asks for no read; each rule's answer and their order (stall, stop, drain, install wait, nothing may start, the probe's three answers, a hold on disk and in the turn, install missing, runner work in the turn, the lanes asked, a lane that started); the pump's end (again, rest, a stall until asked, a busy store's wait, the notes); each `Idle` wake (claims, quiet, pool and a refusal, lane busy, an event since, the re-walk asked, no plan ran, the re-walk's answer); the yield check (a revision, applied runner work and a request; a tier started beside; **R398** as a named row; a file end of a changed tier, of neither, of a tier gone; the yield bound; several events); a port that throws (decisions before it stand); the closed lists (`@ts-expect-error` rows for an unplaced decision kind and an unplaced event kind).
- `model-fixture.ts`, `model-checks.ts`, `model-scheduler.test.ts`: S over `onStep`: a tier starts only on the install stamp and the probe of its own iteration, never in a step inside another turn, never with runner work queued; a step states at most one wake. The test also asserts that some step started a tier. Discrimination: with the probe rule changed to start without the probe read (temporary edit, reverted), S failed on F's, R398's, R427's and seed 173's sequences ("a tier started without current reads").
- No test was deleted or changed but the model test's three files. `runner-work.test.ts`, `tier-yields-clock.test.ts` and `untracked-promises.test.ts` each caught a defect of a first version and pass unchanged.

## Type changes (all additive)

- New module `step.ts`: `step`, `Decision`, `Turn`, `Reads`, `InstallRead`, `ProbeRead`, `LanesRead`, `StepPorts`, `NextWake`, `Step`.
- `step-events.ts`: `SchedulerEvent` gains `pump-ended`; new `DecisionPlace`, `StepDecision`, `StepDecisionKind`, `DECISION_PLACE`, `placeOf`.
- `src/core/types/scheduler.ts`: `Scheduler.onStep?(listener)`, `StepSeen`.
- `slow-release.ts`: `SlowRelease.idleLanes()`, `SlowRelease.closeIdle(lanes)`.

## Checks

See the final section, "Checks run", written at the end of the row.

## For 011-357

- The lanes are asked through `ask-lanes`, an after-turn decision whose answer (`reads.lanes`) carries the fast plan's idle answer to the next step. When the lanes decide in the step, `askSlowLanes` becomes the lane rule, and `Reads.lanes`, `LanesRead` and `#groupLanesNext` go.
- The slow lanes' host still calls `#probe()`, which reconciles released paths itself. The step's probe goes through `#probeRead` and `#released`.
- `close-lanes` is the one place the step closes idle lanes on a hold. `commandHold()` and `SlowRelease`'s due close still close lanes on their own.
- `scheduler.ts` grew from 1,666 to about 1,760 lines (the ports and the two carry-out switches). The ports could move to a `step-live.ts` beside it if the file should shrink.
