# Row 011-365: the step's live adapter and carry-out beside `step.ts`

Worker bbc0f68e, wave 105 (`tasks/wave-105.md`, W1), 2026-11-15. Evidence: `quality/2026-11-15-card-7.md` R2 and S4. Baseline: cand/0.1.517 (`3e6f167aa`, brief commit). Behaviour preserved.

## What changed

- `step-live.ts` (new, 293 lines): `StepLive`, the step's live adapter. It holds the ports (`#ports`), the fast plan's live view (`#plan`, `idleNow`), the yield check's carry-out (`#checkYields`), both carry-out switches (`#carry` in the turn, `#carryAfter` after it), the install read's state (`#installMissing`, `#refreshOwed`), the step listeners (`onStep`, `#told`), and `step(events, reads)`, which builds the turn with the one clock reading. It reads the scheduler only through `StepHost`.
- `scheduler.ts`: 1,760 to 1,584 lines (176 fewer). It keeps the lifecycle: the pump's loop and its waits (`#waitFor`, `#nextEvent`, `#eventOrAt`, `#claimWake`), the flights (`#fly`), the passes, the probe of disk facts (`#probeRead`), the re-walk's queueing (`#queueRewalk`). Its three step sites (`#step`, `#stepInTurn`, the pump's end) are one call each, `this.#live.step(...)`, and the pump carries out the after-turn decisions with `this.#live.after(decided)`.
- `step-events.ts`: `DecisionAt<P, T, S>`, the decisions `DECISION_PLACE` places at `P`, and the guard `inTurn(decision)`. Each decision's place is stated once, in `DECISION_PLACE`.
- `step.ts`: `TurnDecision` and `AfterDecision`; the port `carry` takes `TurnDecision`; `Out.decide` uses `inTurn`; `Step.laneAnswered` (see "The slow release's arm").

## The eleven cross cases (S4)

`#carry` switches over `TurnDecision` (5 kinds) and `#carryAfter` over `AfterDecision` (6 kinds); each ends in `unplaced(decision: never)`. The six throwing cases of the old `#carry` and the five `return {}` cases of the old `#carryAfter` are gone: a case for a kind of the other place does not compile. A kind added to `StepDecision` without a `DECISION_PLACE` entry still fails at `satisfies Record<StepDecisionKind, DecisionPlace>`, and the `@ts-expect-error` row in `step.test.ts` ("an unplaced decision or event kind does not compile") still holds (typecheck passes with it).

## The slow release's arm

The old `askLane` port armed the slow release (`#slowRelease.arm()`) after each lane's answer. The port now returns the lane's answer and relabels the lock only. The step states that a lane answered (`Step.laneAnswered`, set after each `askLane` that returns); `StepLive.step` arms the release once after the step when it is set, before the listeners hear the step. Same lock turn, same clock.

Timing difference: the arm runs once after the step's last rule instead of after each lane. The wake is `atMost` the earliest bound of the idle open lanes. Over several lanes in one step the armed wake is the same unless a lane asked earlier in the step was idle at its answer and became busy (a load guard's wait began) by a later lane's answer; then the old code had armed its bound and the new one does not. That wake would have found the lane busy and closed nothing. A lane decision that throws: neither arms, as before (the flag is set only after `askLane` returns; an earlier lane's answer still arms, as before).

## Type changes (all additive or narrowing a port's parameter)

- `step-events.ts`: new `DecisionAt`, new `inTurn`.
- `step.ts`: new `TurnDecision`, `AfterDecision`; `Step.laneAnswered: boolean` (new field); `StepPorts.carry(decision: TurnDecision)` (was `Decision`; a test port that takes `Decision` still fits).
- `step-live.ts`: new `StepHost`, `StepLive`, `STEP_OPERATION` (moved from `scheduler.ts`), `unplaced` (moved; `#waitFor` uses it too).

## Decisions the record did not settle

- The module holds the fast plan's live view (`#plan`, `idleNow`) beside the ports, since only the ports use them; `#probeRead` and `#queueRewalk` stay in `scheduler.ts` as host calls (`StepHost.probe`, `queueRewalk`) because they read the holds, the runtime folder and the re-walk's state there. The carry-out switch names each.
- `#waitFor` stays in `scheduler.ts`: it is the pump's wait (the quality file's R2 listed it; the brief's lead did not).
