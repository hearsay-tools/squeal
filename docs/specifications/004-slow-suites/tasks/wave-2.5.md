# 004 wave 2.5 brief: the wave-2 review's blockers

## 004-23 the slow-tier line and the slow Stop gate tell the truth (B1, B2, B3)

Outcome: the slow-tier line never names a finished file as running, a slow failure never names artifact declarations its run did not have, and `stop.requireSlowSuite` decides on one snapshot.

Read: `reviews/wave-2.md` (FAIL at `6418a6b`): B1, B2, B3, their probes, and "Inputs for the next wave" 3 to 5; spec 004 D7, D8; `tasks/004-15/notes.md`.

Shape: repair. Test first: each probe is a failing test at `6418a6b` on Node 22 and 24. B1: retire a run's published activity at completion, discard, error and close, together with recording it (`src/core/scheduler/slow-tier.ts`, the recording path in `scheduler.ts`), publish the remaining queue's wait reason without starting another file, and render "running" only when the named file is running. B2: keep the artifact declaration with the executed key or result and render that, "unknown" for results stored before it; never today's policy for an old revision. If that needs a store schema or table change, stop and ask me first: the store is the 001 lane's. B3: `stopTurn`'s `requireSlowSuite` decision reads states, keys, header and slow classification in one read transaction at one revision. Keep the slow-only no-wait control, the mixed fast/slow wait and the `stopHookActive` loop guard in both harnesses.

Owns: `src/core/scheduler/slow-tier.ts`, the recording path in `src/core/scheduler/scheduler.ts` (not lanes or `#pump`; 003-26 adds a `refreshObserved` method there), `src/core/slow/state.ts`, `src/core/state/**`, `src/core/delivery/**`, `src/harness/shared/stop.ts`, `src/core/types/status.ts` and `delivery.ts` (additive), their tests. Leave alone: `src/core/store/**` unless agreed, `src/core/scheduler/observed.ts` (001-148), `src/runners/**`, `src/core/daemon/**`.

Done when: the three probes and the review's controls are tests on both Nodes; lint, typecheck, full suite on Node 24 and 22. Report every type change. Do not run `npm run build`; keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; re-run a failing file alone before calling it yours.

Use /worker.

## 004-24 re-review of wave 2.5

Outcome: `reviews/wave-2.5.md`: are `reviews/wave-2.md` B1 to B3 closed, and did the repair break anything around them. Range: `git log --oneline d882196..068f6de` on main, 0.1.52. In scope: the 004-23 commits and the bundles. Also in scope as a first review round: 003-26 (the daemon's observed timer, `Scheduler.refreshObserved`, the runner-only refinement): can it re-key too little (a grown preload set, a project added while running), run when nothing changed, keep the daemon alive, or count as activity? The 001 commits and the wave-13b S2 fix in `escaped.ts` are out of scope. Rules as for 004-14. For 004-23 this is the second and last review round: a remaining blocker goes to the human.

Use /reviewer.
