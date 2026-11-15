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

## R1 (W1): review of cand/0.1.513

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.513` at `cceb500f0e644899fe3090b82bf9a0cb40f1d78b`; candidate CI run 43713819243. Range `1df9818ae..cceb500f0`: three commits of worker 9b8a107e (cherry-picked from `c5f167179..e0b5e2f40` without conflict), then the 0.1.513 raise and bundles. Read: board row 011-352, this file's W1, `tasks/011-352/notes.md`, `../research/scheduler-step.md` ("The wake loop", "Timing differences").

Check, each as proven, plausible or unverified:

1. **One timer.** The grep in the notes holds; every other owner states its wake through `Wakes` and runs in a pass in the written order (`step-events.ts` `WAKE_ORDER`) with that pass's one reading; the pump's five waits are one; no wake is lost when an owner re-states, clears or throws, and closing the scheduler disarms the timer.
2. **Steady time.** The worker keeps each wake as a delay on a steady time (`Clock.ticks()`, host `performance.now`) instead of the scheduler's reading, because tests inject a `now` that stands still. Judge whether this keeps "time as an input" honest: on the virtual clock the two must agree, and in the daemon no wake fires earlier or later than the owner's own timer did, beyond the record's named differences.
3. **Behaviour preserved.** No tier, order, width, status payload, note text, CLI output (including the lock watcher's operation texts) or key changes. The timing differences are the record's five plus the notes' smaller ones; the merge-hold poll's fixed delay after a check and the command hold's end in the loop's turn change nothing a user sees.
4. **`rest()`.** It resolves only when no pass runs, no tracked work is open, the lock has nothing queued or running (count hook, not a wrapper), no wake is due, after one `setImmediate`; a runner's run is set aside; a pending busy resume is reported, not waited for. Look for a false rest a test could rely on.
5. **Promise check.** `untracked-promises.test.ts` catches a bare `void` call or a detached `.catch(` under `src/core/scheduler` outside the loop's tracking and is not trivially bypassed; its two allowed exceptions are justified.
6. **Scope and tests.** Out-of-scope owners (`busy-resume.ts`, `store/busy.ts`, `local-permits.ts`, `src/core/capacity/`, `record-tier.ts`, `model-*.ts`) untouched; the files outside the brief (`types/scheduler.ts`, `record.ts`, `context.ts`) were granted; the four moved fake-timer tests keep their cases' meaning on the virtual clock; review 0.1.512 S1 is done in `clock-port.test.ts`.

The coordinator's tree passed lint, typecheck, `check:version origin/main` and `key-format` with `version-sensitive` (19 tests) at the candidate; the worker's tree had all 1298 affected files current (4 bundle-drift failures, fixed by the bundle commit). CI is the full suite. Main's push CI 43709724871 (0.1.512) failed one 5 s timeout in `test/status/why-unknown-standing.test.ts` on Node 26; its rerun is pending; say if you see a link to this range. Host policy as in `wave-85.md`; never the real `HOME`; a `/tmp` copy calls `node_modules/.bin/vitest` directly, never `pnpm exec`. Write `reviews/0.1.513.md` and commit it on your branch.

## R2 (W1 repair): re-review of cand/0.1.513 after `reviews/0.1.513.md`

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.513` at `d77d1f9d89699972800f1acfade3de9096cb9c74`; candidate CI run 43718202283. The branch was rebuilt on main `c440f8cf1`: the three first-round commits of worker 9b8a107e (unchanged), then its six repair commits (picked from `e6d3a470a..46877b326`), then the 0.1.513 raise and bundles. Narrow re-review: the repair range `aa2718f76..f3c2fcd87` and how it meets `reviews/0.1.513.md`. Read that review, `tasks/011-352/notes.md` "Repair after review 0.1.513".

Check, each as proven, plausible or unverified:

1. **B1.** `rest()` resolves while a runner's run is held (`scheduler-rest.test.ts`, the review's reproduction), and a rest asked when the run returns resolves only after its record and the pump's last pass. The pump's set-aside waits cannot hide runnable work: no false rest while the pump can act.
2. **B2.** The next arm is measured from the steady time at arming; the review's probe (wakes at 50 and 100, first done at 150) arms at 150; owners still get one reading per pass.
3. **B3.** Slow-lane wakes due together run in the current policy order after a reorder or an insertion, the default `slow` last, each lane keeping its state and pending wake (`wake-lane-order.test.ts`, real `GroupTiers` and `SlowTier`); the `group-tiers.ts` edit (granted) changes nothing else.
4. **S1.** The promise check rejects an assigned-but-unconsumed promise and states its syntax-only guarantee; no product file newly flagged.
5. **No new break.** The repair adds no timing difference beyond the notes and changes nothing a user sees.

The coordinator's tree passed lint, typecheck, `check:version origin/main` and `key-format` with `version-sensitive` (19 tests) at the candidate; the worker's tree had 932 affected files current at the repair (4 bundle-drift failures, fixed by the bundle commit) and a direct run of 18 files (123 tests, including the model test and the key tests). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; a `/tmp` copy calls `node_modules/.bin/vitest` directly, never `pnpm exec`. Write `reviews/0.1.513-r2.md` and commit it on your branch.

## W1 repair 3: one rule for "still working" (the human, 2026-11-15, "Rest signal: 1: one rule, third repair")

Use /worker (worker 9b8a107e, resumed). Shape: repair. Effort high.

Outcome: `rest()` follows one rule, written once in `wakes.ts`: every piece of scheduler work that runs on its own is counted on its own, and a piece stops counting only while it waits for a stated wake of the loop or for a held runner run. No other wait sets work aside.

Why: four gaps in one mechanism (reviews `0.1.513.md` B1, `0.1.513-r2.md` B4, the slot-gather gap 011-353 found, the order of `track`), each patched by setting one more wait aside on a shared count (`docs/process.md` step 6, "a single owner of the rule").

Lead: replace the general `Wakes.aside` with waits that name what they wait for, from a closed list (a wake reason, or a runner run), taken by the piece that waits; concurrent branches inside one flight (the ended reads beside the slot gather, the record, the drain) are tracked as their own pieces; nothing subtracts another piece's count. The promise check gains a rule: no set-aside outside those named waits.

Done when: the review `0.1.513-r2.md` B4 reproduction passes as a test (rest stays pending while gated reads run; after release it reports the future gather; after `advance` it waits for the record and the pump); the B1, B2, B3, S1 and slot-gather tests still pass; `model-scheduler.test.ts` passes on the branch with worker 7a90f9aa's commits `44d77515d..e16f56e27` picked on top (run once, when the load is below 24); the notes' repair section states the rule and names what it replaced; no timing difference beyond the notes; lint, typecheck, `squeal status --wait 60000` on changed paths, `key-format` pass.
