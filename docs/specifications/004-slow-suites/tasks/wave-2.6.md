# 004 wave 2.6 briefs: the human's fix-and-third-review round, and the e2e

Decided by the human 2026-10-09: 004-23's remaining B1 and B2 (`reviews/wave-2.5.md`) get a fix and a third review; spec 003 ships after a review of 003-41; the quality pass waits until spec 001 and these fixes land.

Common rules: do not run `npm run build`; keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start; re-run a failing file alone before calling it yours. `test/scheduler/first-observation.test.ts:146` on Node 22 is known (001-148).

## 004-25 a slow failure names its own run's artifact; Stop's last retry keeps its guard

Outcome: `reviews/wave-2.5.md` B1 and B2 closed.

Shape: repair. Test first: both probes fail at `068f6de` on Node 22 and 24. B1 (`src/core/delivery/attribution.ts`, `provenance.ts`, `src/core/slow/state.ts`): bind a failure's artifact to the result and key the delivered state represents, never to a commit or fingerprint; say "declared artifact unknown" where that association cannot be recovered. If it needs a store or persisted-state interface change, ask me first (the store is the 001 lane's). B2 (`src/harness/shared/stop.ts`, `endTurn` in `src/core/delivery/delivery.ts`): every attempt keeps the revision guard; at the retry bound, block with a short reason rather than end the turn unchecked. Keep the 2 s budget, slow-only no-wait, the mixed wait and the loop guard, both harnesses.

Owns: `src/core/delivery/**`, `src/core/slow/state.ts`, `src/core/state/**`, `src/harness/shared/stop.ts`, their tests. Leave alone: `src/core/scheduler/**`, `src/core/daemon/**`, `src/runners/**`, `test/e2e/**`.

Done when: the review's two probes with their controls are tests on both Nodes; lint, typecheck, full suite on Node 24 and 22. Report every type change.

Use /worker.

## 003-42 the observed timer's snapshot survives a policy reload

Outcome: an observed-key change written just before a policy reload is still noticed after it.

Read: the cause, from 003-41's report: a policy reload restarts the daemon's timers (`#startTimers` in `src/core/daemon/daemon.ts`), which resets the observed timer's last-seen snapshot in `src/core/daemon/lifecycle.ts`, so a change after the last tick and before the reload is taken as already seen.

Shape: repair. Test first. Carry the last acknowledged snapshot across a timer restart (or start the new timer unacknowledged, so its first tick asks once; say which and why). Keep it unref'd, cleared on stop, never activity.

Owns: the observed timer in `src/core/daemon/lifecycle.ts`, `#startTimers` in `src/core/daemon/daemon.ts`, `test/daemon/observed-timer.test.ts`. Leave alone: everything else.

Done when: a test with a write between the last tick and a reload; lint, typecheck, the daemon tests on both Nodes.

Use /worker.

## 004-16 e2e for both repository shapes

Outcome: spec 004's end-to-end line holds through both shipped plugins on Node 22 and 24.

Read: spec 004 Testing ("End to end"), D2, D5, D6 (inheritance only with a declared artifact, decided 2026-10-08: a second worktree inherits a slow result when its declared artifact is equal, never without one), D8; `test/e2e/harness.ts`, `plugins.ts`, `node-test.test.ts` as the pattern.

Shape: slice. Test first. Two shapes, both plugins: this repository's (a Vitest e2e file over a small built `dist`, `slow.include`, `inputs` keyed by `dist/**`) and cezarion's (a node:test project, `slow: true`, keyed by `dist`). Each: an edit reports its fast tests first; the slow file runs when the consumer goes idle and on `squeal run --slow`; a `dist` change re-runs it; a second worktree inherits it only with the artifact equal. Set `slow.maxLoadPerCpu` high.

The slot: it is `/tmp/squeal-<uid>/slow.lock` for every daemon of the user (`src/core/slow/slot.ts`), so a slow e2e file run by an outer Squeal daemon (004-17 will declare `test/e2e` slow) holds the slot its inner test daemons need. Make the slot directory follow the daemon's `XDG_RUNTIME_DIR` when set (as its socket does), else `/tmp/squeal-<uid>`, in its own commit with a test, and amend spec 004 D2's slot sentence with a dated `status.md` line.

Owns: new `test/e2e/slow*.test.ts`, fixtures under `test/fixtures/e2e/slow*/`, additive helpers in `test/e2e/harness.ts` and `plugins.ts`, `src/core/slow/slot.ts`, spec 004 D2 and `status.md`. Leave alone: the rest of `src/**`. A product defect the e2e finds: report it with its reproduction; do not fix it here.

Done when: both shapes pass on both plugins on Node 24 and 22; lint, typecheck, full suite.

Use /worker.

## 004-26 third review: 004-25, 003-41, 003-42

Outcome: `reviews/wave-2.6.md`, committed. Range: `git log --oneline 35e2769^..265f783` on main, 0.1.55 (003-41, 003-42, 004-25 and their bundles; 001 commits before it are out of scope). For 004-25: are `reviews/wave-2.5.md` B1 and B2 closed (third and last round, by the human's decision). For 003-41 and 003-42: first review; spec 003 ships on its result. Also for 004-25's new `failure-keys:<worktreeId>` meta row, written by `src/core/state/sink.ts` for every applied result (from the 001 coordinator): measure a 2,000-result apply transaction's write-lock hold with and without it at this host's load, and prove that a crashed or timed-out run never removes a still-failing check's key. Rules as for 004-14.

Use /reviewer.
