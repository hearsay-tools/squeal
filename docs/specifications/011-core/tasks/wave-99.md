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

## R1 (W1): review of cand/011-353

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-353` at `97c629afb0f55fff04e2c45591d45a926c61f1ab`; candidate CI run 43726276467. Test files and notes only, so no version raise and no bundle change (`check:version` passes at 0.1.513). Range `bf9f8052f..97c629afb`: seven commits of worker 7a90f9aa, cherry-picked onto main after 0.1.513 (row 011-352) landed. Read: board row 011-353, this file's W1, `tasks/011-353/notes.md`, `../research/scheduler-step.md` (the model-test paragraph of "Tests: replace, don't layer"), research 016 `model-scheduler.md`.

Check, each as proven, plausible or unverified:

1. **Same model test.** The same directed sequences, seeds, sweeps and properties run and pass; none was dropped, weakened or made vacuous by the virtual clock. Judge the notes' "meaning changes" (a step fires each timer due on the way at its own time; a slot's record lands at the drain's next step): is any property now checked at a point where it can no longer fail?
2. **Workarounds gone.** No global `setTimeout` swap, prototype wraps, real-sleep settle or `requestRetries()` nudge remains in the model files or harnesses; nothing imports `model-clock`.
3. **The virtual clock.** `prompt` (a due timer fires on the host's next turn) and `jump` cannot let `rest()` resolve while a due wake waits, and do not hide a race the old real-time settle would have shown; `CrossingClock`'s lazy start matches `ModelClock`.
4. **Harnesses.** `catch-up-fixture.ts` and `vitest-harness.ts` keep their default; `clock: "virtual"` with `rest()` works.
5. **Scope.** Only test files changed, plus the four import-line edits the coordinator granted (`batch-fixture.ts`, `promoted-tier-fixture.ts`, `tier-yields-named.test.ts`, `tier-yields-next-tier.test.ts`).

The coordinator's tree passed lint, typecheck, `check:version`, `key-format`, `version-sensitive`, and the model test with five related files (33 tests, 20.4 s at load 6.7) at 0.1.513 plus these commits. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; a `/tmp` copy calls `node_modules/.bin/vitest` directly, never `pnpm exec`. Write `reviews/011-353.md` and commit it on your branch.

## R2 (W1 repair): re-review of cand/011-353 after `reviews/011-353.md`

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-353` at `c0877289f61a46a6622c844bfdaa7c497c0bc73f`; candidate CI run 43727557797. Narrow: the repair `97c629afb..c0877289f` (worker 7a90f9aa `59393ef97`, `8e9f10193`, cherry-picked): `advance` ends at the later of the reached time and `until`, so a jump made inside a timer stays; two regression cases in `model-harness-clock.test.ts`. Read `reviews/011-353.md` and the notes' "Repair after review 011-353".

Check, each as proven, plausible or unverified: B1's reproduction passes; `advance` still fires due timers in time order and never moves time backwards or skips a timer due before the reached time; nothing else in the helper or the model test changed. Worker evidence: the two cases failed before the fix; `model-harness-clock`, `clock-port`, `wakes` 37/37; the model test 7/7 in 16.2 s at load 11; coordinator: lint, typecheck, `model-harness-clock` with `clock-port` 18/18. Host policy as in `wave-85.md`; never the real `HOME`. Write `reviews/011-353-r2.md` and commit it on your branch.
