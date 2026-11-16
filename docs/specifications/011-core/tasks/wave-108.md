# Wave 108: the wake loop keeps one time (row 011-369)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-15 (rows 011-358 to 011-371). Evidence: `../quality/2026-11-15-card-7.md` R4 and section 4 ("Fixed-`now` sites"); `status.md` line of 2026-11-15 for row 011-352 (the accepted deviation: wakes kept on a steady time because tests pass a `now` that stands still); `tasks/011-368/notes.md` "For the next worker" (files still on the old fixed clock: `backlog-quiet-exempt`, `batch-beside`, `batch-line`, `background-runs`). Rows 011-364, 011-363, 011-367 and 011-368, which this row waited on, are on main. Base: cand/0.1.519 (row 011-370, in review).

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Run the model test once when the load is below the CPU count. Stop your Squeal daemon before you finish. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-369

Use /worker. Shape: slice. Effort high.

Outcome: the scheduler keeps one time, the clock it is given: `Clock` has `now` and `arm` only, `SchedulerOptions.now` is gone, and a wake is due when `clock.now() >= wake`.

Lead: move every test that gives the scheduler a fixed `now` (about 15 explicit `SchedulerOptions.now` sites, plus `harnessClock`'s implicit `{ now }` in `test/helpers/virtual-clock.ts`, plus the four files above) to `clock: virtualClock(...)` or the host clock; then remove `SchedulerOptions.now`, `Clock.ticks()`, the loop's `#steady`, `Slot.due`'s steady form and `#armed.until`; `wakes.test.ts` and `clock-port.test.ts` lose their steady-time cases, each named in the notes.

Name this timing difference in the notes and test it on the virtual clock: in the daemon, wakes now follow the host's wall clock (`Date.now`), so a wall-clock jump moves a pending wake (a jump back delays it, a jump forward lets a pass fire it early); before, each wake kept its delay on the steady clock. Say whether the one timer still re-arms correctly after a backward jump (no stall, no busy loop). If this difference changes anything a user sees beyond a wake's time after a clock jump, stop and message me before finishing.

Owns: `src/core/scheduler/{clock,wakes,options,scheduler}.ts` (the clock and wake lines), `src/core/types/scheduler.ts` if `now` is declared there, `test/helpers/virtual-clock.ts`, `test/scheduler/wakes.test.ts`, `clock-port.test.ts`, and every test file whose only change is moving a fixed `now` to a clock. Leave alone: `busy-resume.ts`, `store/busy.ts`, `local-permits.ts`, `src/core/capacity/` (cards 9, 10), `record-tier.ts`.

Done when: row 011-369's done-when; `grep -rn "ticks\|#steady\|SchedulerOptions.*now\|now?:" src/core/scheduler/ src/core/types/scheduler.ts` shows none of the removed parts (paste it in `tasks/011-369/notes.md`); `key-format` without a raise; lint, typecheck and `squeal status --wait 60000` on the changed paths pass; report pending checks as such. A real bug found on the way is a proposed row with a failing test, not a fix here.
