# Wave 99: the model test on the virtual clock (row 011-353, card 7)

Coordinator 4c0bbe28, 2026-11-15. Approved by the human on 2026-11-15 ("Rows: Approve, land, start"). Design: `../research/scheduler-step.md` ("The test picture", "Tests: replace, don't layer", the model-test paragraph; row 3); research 016 `model-scheduler.md` for what the model test checks. Builds on 011-351 (`clock.ts`, `test/helpers/virtual-clock.ts`) and 011-352 (`wakes.ts`, `Scheduler.rest()`; `tasks/011-352/notes.md` "For 011-353").

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. A `/tmp` copy calls `node_modules/.bin/vitest` directly, never `pnpm exec`. The model test is long: run it when the one-minute load is below the CPU count, one run at a time. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION`.

## W1: row 011-353

Use /worker. Shape: slice. Effort medium.

Outcome: the model test drives the scheduler on the virtual clock and settles with `rest()`, with no global timer swap, no prototype wraps, no real-sleep settle and no retry nudges; the same plans, seeds and properties pass.

Read: board row 011-353; `test/scheduler/model-{clock,fixture,checks,plans}.ts` and `model-scheduler.test.ts`; `src/core/scheduler/wakes.ts` (`rest()`, `wakes()`), `test/helpers/virtual-clock.ts`.

Seam: `model-fixture.ts`. Lead: build the scheduler with `clock: virtualClock(...)`; replace the settle (`model-fixture.ts` about line 363, the 1 ms real sleeps to 4 ms of quiet) with `advance(0)` then `await scheduler.rest()`; drop `watchWork`'s four prototype wraps (`Mutex.run`, `TierRecords.record`, `InstallStamps.check`, `MergeHold.check`) for what `rest()` reports; drop the `requestRetries()` nudges (lines 213, 249). Then delete `model-clock.ts` once nothing imports it. The `cross`/`uncross` reading jumps move onto the virtual clock. Then the harnesses: `catch-up-fixture.ts` and `vitest-harness.ts` gain `clock: "virtual"` (a virtual clock plus `rest()`), default unchanged; moving other test files to it is later quality rows.

Owns: `test/scheduler/model-*.ts`, `test/scheduler/catch-up-fixture.ts`, `test/scheduler/vitest-harness.ts`, `test/helpers/virtual-clock.ts`. Leave alone: everything under `src/` (a gap in `rest()` or the virtual clock that the model test exposes is a message to the coordinator with a failing case, not a fix here), every other test file.

Done when: the row's done-when holds: `grep -n "realSleep\|realSetTimeout\|watchWork\|requestRetries\|model-clock" test/scheduler/` prints nothing (paste it in the notes); the same directed sequences, seeds and properties pass (name them, with any a virtual clock changed in meaning); the harnesses offer `clock: "virtual"` and `rest()`; `tasks/011-353/notes.md` records the model test's wall time against today's 18 to 30 s, with the one-minute load at the run. Lint, typecheck and `squeal status --wait 60000` on the changed paths pass; report pending or unknown checks as such. A real bug found on the way is a proposed row with a failing test, not a fix here.
