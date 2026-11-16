# Wave 113: a test-only quiet point that also sees runner work (row 011-378)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Idle sweep: Approve all": rows 011-378 to 011-381, then 011-371). Base: main at 0.1.523 plus docs. Row 011-377 (wave 112 W1) runs beside this row and edits `test/helpers/virtual-clock.ts`, `test/scheduler/clock-port.test.ts`, `claims-expiry.test.ts`, `step-reading.test.ts` and the new `calendar-steps*.test.ts`: leave those alone. Rows 011-379 (class A) waits for 011-377 to land; 011-380 and 011-381 wait for this row.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`, every `src/` file.

## W1: row 011-378

Use /worker. Shape: slice. Effort high.

Outcome: a test can wait until the scheduler rests and no runner call is open, through one test-only quiet point per scheduler builder, so the sweep rows can drop `Scheduler.idle()` file by file.

Read: board rows 011-371 and 011-378; `tasks/011-371/survey.md` (all of it: "Row H", the fixture table, the appendix probe); `GLOSSARY.md` "Rest"; `Scheduler.rest()` and `idle()` in `src/core/scheduler/scheduler.ts`; `settle` in `test/scheduler/tier-yields-fixture.ts`; `tasks/011-363/notes.md`.

Decision (coordinator, survey option 1): test-only, no `src/` change. Each builder wraps the `RunnerAdapter` it hands to `createScheduler` in a counter of open calls (`run` and the runner-part calls); `quiet()` loops `rest()` until no call is open and the runs mark holds across one timer turn. On a virtual clock it moves no time (except the slot-gather rule `settle` already has).

Seam: `test/runners/vitest/` harness `schedulerRunner` wrapper first (the survey names it), with a test of the quiet point itself: it returns only after a run in flight ends; it returns at once when nothing is open; it never moves a virtual clock. Then `node-test-harness.ts`, `catch-up-fixture.ts` (and `settle` reading the counter), then the 14 fixtures the survey assigns to row H, each fixture's `idle()` calls moved to the quiet point. Pilot about 5 class-B files from the survey's B lists across the builders, each 3 of 3. Re-run the survey's probe on each moved fixture's test files and show no call is left `aside`.

Owns: the builders and the 14 fixtures the survey names for row H, a new helper if one fits (`test/helpers/quiet-point.ts`), its test, the pilot files. Done when: row 011-378's done-when; every moved fixture's test files pass 3 of 3 (load stated); `tasks/011-378/notes.md` names the quiet point's contract, each builder and fixture moved, and the pilot; lint, typecheck and `squeal status --wait 60000` on the changed paths.

## R1 (W1): review of cand/011-378

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-378` at `7ada936623fc36eb8ed256c438db057ebf0dd0f2`; candidate CI run 43903971514. Test files and notes only: no `src/` change, no version raise. Range `314d8c1aa..7ada936623fc36eb8ed256c438db057ebf0dd0f2`: worker 312a691f's seven commits (row 011-378), cherry-picked without conflict. Read: board rows 011-371 and 011-378; this file's W1; `tasks/011-378/notes.md`; `tasks/011-371/survey.md` ("Row H", the fixture table); `GLOSSARY.md` "Rest".

Check, each as proven, plausible or unverified:

1. **The quiet point's contract.** `quiet()` returns only when the scheduler rests, no counted runner call is open, and none started or ended across one timer turn; it counts every runner call except `close`; on a virtual clock it moves time only to a backlog gather when no other wake comes first (as `settle`). It cannot return while a run the test depends on is still in flight; it cannot hang where `idle()` returned.
2. **The decisions the brief did not settle:** waiting in real time for a backlog gather on the host clock; named wakes a test asks to wait through (`claims-split`'s claim recheck); not waiting for a runner-part call the scheduler abandoned (as `idle()` did not). Say for each whether it hides a run a test depends on.
3. **The 14 fixtures and the two loops** (the model fixture's `drain`, `idleOn`) keep every case's meaning; `settle` reading the call counter sees what it saw before and the remote lane it missed.
4. **The pilot** (five class-B files) and the probe evidence (204 of 204 return points resolve `idle()` at once; 70 files 3 of 3).
5. **The change in `fresh-worktree-durations.test.ts`** (a row 011-379 file) is only its builder.

Coordinator at the candidate: lint and typecheck pass; `quiet-point.test.ts`, three pilot files and the model test pass (22 tests, load 17). Worker: 70 files 3 of 3 (319 tests), Squeal 278 current, no failure. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/011-378.md` and commit it on your branch.

## W1 repair: after review 011-378 (FAIL)

Use /worker (worker 312a691f, resumed). Shape: repair. Effort high. Read `reviews/011-378.md`. B1: `quiet()` waits only for a counted call to end (`nextEnd`), so a call the scheduler abandons after `quiet()` began (a runner-part bound at 400 ms) holds it until its guard while `idle()` has returned. Repair: re-sample the scheduler's rest while calls are open, so an abandonment during the wait is seen; keep waiting for a live run the test depends on; move no virtual time to a bound. Test first: a real scheduler with an `invalidate` held open and `runner-part-bound` armed when `quiet()` starts; it returns once the scheduler abandons the call, on the host clock and on a virtual clock. Fold the review's other items as it says. Done when: the new case failed before; the 70 files of your earlier run still pass (one round is enough unless one fails; state the load); lint, typecheck, `squeal status --wait 60000` on the changed paths; notes gain "Repair after review 011-378".
