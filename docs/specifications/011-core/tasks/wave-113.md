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
