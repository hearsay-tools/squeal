# Wave 98: one wake and the rest signal (row 011-352, card 7)

Coordinator 4c0bbe28, 2026-11-15. Approved by the human on 2026-11-15 ("Rows: Approve, land, start"; "Wake shape: 1 + lists, splits first in step"). Design: `../research/scheduler-step.md` (decision 2; "The wake loop", "Timing differences", "Tests: replace, don't layer"; row 2). Builds on 011-351 (`src/core/scheduler/clock.ts`, `test/helpers/virtual-clock.ts`; `tasks/011-351/notes.md` "For 011-352"; `reviews/0.1.512.md` "Inputs for the next wave").

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. A `/tmp` copy calls `node_modules/.bin/vitest` directly, never `pnpm exec` (it re-verifies the shared `node_modules` and queues a broad run). Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION`.

## W1: row 011-352

Use /worker. Shape: slice. Effort high.

Outcome: the scheduler has one timer, armed through `Clock.arm` at the earliest wake any owner states, and `Scheduler.rest()` tells a test when nothing is left to do; behaviour preserved.

Read: board row 011-352; the record's "The wake loop" (the written order of owners, the five waits, `SchedulerEvent`/`WakeReason`, `rest()`, the promise check) and "Timing differences"; `GLOSSARY.md` "Wake", "Rest", "Scheduler event"; `test/keys/validity/compare.test.ts` and `reach.test.ts`.

Seam: new `src/core/scheduler/wakes.ts` and `step-events.ts` (the closed lists). Lead: the pump's five waits first (`scheduler.ts` `#nextEvent`, `#claimWake`, `#quietWake`, `#capacityWake`, `#eventOrAfter`, about lines 1373-1430) become one wait for an event or a time through the loop; then the wake-only owners (`claims.ts` poll, `slow-tier.ts:809-819`, `slot-records.ts` sleep, `hold.ts:195` interval with its fixed-delay difference); then the deciding owners (`command-hold.ts:154`, `slow-release.ts:99`, `yields.ts:292`, `runner-work-bound.ts:52`). Each owner states `at`/`atMost` in its slot and runs in the loop's turn in the written order; the decide/act splits are not this row (011-354, 011-355). `#notify` sites post a typed `SchedulerEvent`; the pump still reads only "an event came".

Split point: if it grows too large, stop after the loop, the closed lists, `rest()`, the promise check and the wake-only owners, all tests passing, and report; the deciding owners become the second half.

Owns: `src/core/scheduler/{wakes,step-events,clock,scheduler,claims,slow-tier,slot-records,hold,command-hold,slow-release,yields,runner-work-bound,mutex,options}.ts`, `test/helpers/virtual-clock.ts`, new `test/scheduler/wakes.test.ts` and the promise check, and the fake-timer tests whose owner moves (`promoted-tier-bound`, `runner-part-bound`, `slow-release`, `tier-yields-bound`: onto the virtual clock, cases unchanged in meaning). Leave alone: `busy-resume.ts` and its test, `src/core/store/busy.ts`, `local-permits.ts`, `src/core/capacity/` (cards 9 and 10), `record-tier.ts` (card 1), `test/scheduler/model-*.ts` (011-353), every other existing test file.

Also (review 0.1.512 S1): in `clock-port.test.ts`, build the host clock before `vi.useFakeTimers()`, then assert its default reading follows `vi.setSystemTime` and its arms follow the fake timer.

Done when: the row's done-when holds: `grep -rn "setTimeout\|setInterval\|timers/promises" src/core/scheduler/` lists only `clock.ts`, `busy-resume.ts`, `local-permits.ts` (paste it in the notes); `wakes.test.ts` (earliest wins, a past wake fires next, written order at one time, one reading per pass, close disarms, rest under tracked work, lock work and a set-aside run) and the untracked-promise check pass; the moved fake-timer tests pass on the virtual clock; existing scheduler tests pass unchanged; `key-format.test.ts` passes without a raise, and `compare.test.ts`, `reach.test.ts` pass. `tasks/011-352/notes.md` names each timing difference of the record this row causes and any decision the record did not settle. No tier, order, width, status payload, note text, CLI output (including the lock watcher's texts) or key changes. Lint, typecheck and `squeal status --wait 60000` on the changed paths pass; report pending or unknown checks as such. A real bug found on the way is a proposed row with a failing test, not a fix here.
