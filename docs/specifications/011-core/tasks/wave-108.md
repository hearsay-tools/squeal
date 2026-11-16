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

## R1 (W1): review of cand/0.1.520

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.520` at `cbbeda6d1cd78c608e333dde0798dd5c3ac71dcc`; candidate CI run 43798694402. Range `1c3719de1..cbbeda6d1cd78c608e333dde0798dd5c3ac71dcc`: worker 53e1f045's two commits (row 011-369), cherry-picked without conflict, then the 0.1.520 raise and bundles. Read: board row 011-369; this file's W1; `tasks/011-369/notes.md`; `status.md` line of 2026-11-15 for row 011-352 (why the steady time existed); `../quality/2026-11-15-card-7.md` R4.

Check, each as proven, plausible or unverified:

1. **One time.** `Clock` has `now` and `arm` only; `SchedulerOptions.now` is gone; the loop keeps no steady time; a wake is due when `clock.now()` reaches it; the grep in the notes holds. The three files outside the brief (`daemon.ts` passing `clock: hostClock(this.#now)`, `daemon-loop/index.ts`, `one-loop-source.test.ts`'s new allowed file) change nothing else.
2. **The wall-clock difference, the point to weigh.** In the daemon, wakes now follow `Date.now`: a clock set back by D delays every pending wake by D (a 20 s quiet wait, set back 1 h, ends 1 h 20 s later); a clock set forward lets a pass fire a wake early. Before, each wake kept its delay on `performance.now`. Prove the timer re-arms with no stall or busy loop after either jump, say what a user sees in each case (how long Squeal can sit idle, which waits are affected: quiet, claims window, slot gather, holds, bounds), and whether any wake could be skipped. Name any design that keeps one time for decisions but bounds a wake's real delay (for example: the host adapter's `arm` caps a delay at the wake's original length), without reintroducing a second time into the loop. The coordinator holds the landing for the human's decision on this point.
3. **Tests.** The moved fixed-`now` tests keep their meaning (`heldBatch` on the host clock for batch-beside, batch-line, background-runs; `quietSide`'s tenth-speed clock; `batch-line` case 7 on the virtual clock); the replaced `clock-port` and `wakes` cases are named and covered.
4. **Behaviour preserved** apart from point 2: no tier, order, width, status payload, note text, CLI output or key change.

Coordinator at the candidate: lint, typecheck, `check:version origin/main`; direct runs of `key-format`, `version-sensitive`, `wakes`, `clock-port`, `one-loop-source`, the model test, `batch-line`, `backlog-quiet-exempt` pass (69 tests, load 3). Worker: 698 of 702 affected files pass, 4 bundle drift (fixed by the bundle commit). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout. Write `reviews/0.1.520.md` and commit it on your branch.

## W1 rework: two clocks, named by purpose (the human, 2026-11-16, "Timers: D: name both by purpose")

Use /worker (worker 53e1f045, resumed). Shape: slice. Effort high. Candidate 0.1.520 (`cbbeda6d1`, one calendar clock) is abandoned: review `reviews/0.1.520.md` S1 proved that a clock set back 1 h held a 0.4 s runner-part bound and the 25 ms result gather for about 1 h.

Outcome: the scheduler's clock offers two readings, each named for what it answers: **calendar time** ("what time is it": stored times and times compared with other daemons, such as claims, holds, notes, status "since") and **elapsed time** ("how long has it been": every wait and safety limit inside one daemon). Every wake is stated and kept on elapsed time; every stored or compared time comes from calendar time. A calendar-clock change moves no wait.

Lead: start from main (0.1.519) on a fresh branch, keeping what still fits from your 0.1.520 work (the fixed-`now` test moves, `SchedulerOptions.now` gone). `Clock` gets `now()` (calendar, `EpochMs`) and an elapsed reading with its own type (for example `elapsed(): ElapsedMs`, monotonic, host: `performance.now`), plus `arm(ms, fire)`; `ticks` goes as a name. `Wakes` keeps due times on elapsed time only; owners state a wake as a delay (or an elapsed time), never as a calendar time. The virtual clock advances both readings together and can change the calendar reading alone, to test a clock change. `GLOSSARY.md`: add "Calendar time" and "Elapsed time" to "Deciding what runs next".

Tests: a clock change in both directions on the virtual clock: no wait moves, no wake is lost, the timer re-arms; review S1's probe (a held runner-part bound and a finished-slot gather across a 1 h set-back) passes; every owner's wake fires after its delay; the one-loop and untracked-promise checks hold.

Owns: as W1, plus `GLOSSARY.md` (that section), `daemon.ts` and `daemon-loop/index.ts` clock lines. Row 011-372 runs beside you on decision helpers (`beside.ts`, `ledger.ts`, `queue.ts`, `claims.ts` read paths, `step-live.ts`); leave those alone, and whichever lands second rebases.

Done when: the outcome holds; `tasks/011-369/notes.md` lists each clock read under `src/core/scheduler/` as calendar or elapsed with its reason (paste the grep); behaviour preserved, with no timing difference in the daemon beyond what calendar-time stamps already had; `key-format` without a raise; lint, typecheck, `squeal status --wait 60000` on the changed paths; the model test once below the CPU count.

## R2 (W1 rework): review of cand/0.1.523

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.523` at `d5ddd26d5c0346bfa264a2418eb4fc06663c906a`; candidate CI run 43872736374. Range `f0e932201..d5ddd26d5c0346bfa264a2418eb4fc06663c906a` on main at 0.1.522 (peer 1cda3b6f's #228 fix; no shared file but the version files and bundles): worker 53e1f045's three commits (row 011-369 rework, rebased onto 0.1.521 with row 011-372's conflicts resolved), a coordinator test commit `8925e93a4` (review `011-376.md` S1: the coverage turn probe stops in a `finally`; review `0.1.521.md` N1: the new SIGKILL case freezes the check and checks the holder row before the kill), then the 0.1.523 raise and bundles. Read: board rows 011-369 and 011-377; this file's "W1 rework"; `tasks/011-369/notes.md` (with "Rebase onto 0.1.521"); `reviews/0.1.520-abandoned-one-clock.md` S1 (the probe this rework must pass); `status.md` line of 2026-11-16 for the human's decision D.

Check, each as proven, plausible or unverified:

1. **Two readings, by purpose.** `Clock` offers calendar time (`now()`) and elapsed time with its own type; every wake is stated as a delay or an elapsed time and kept on elapsed time; a calendar change moves no wake (the S1 probe: a held 400 ms runner-part bound and a 25 ms gather across a 1 h set-back and set-forward); the timer re-arms with no stall or busy loop; no wake is lost. The notes' clock-read list is complete and each kind is right.
2. **The accepted deviation.** Waits that compare a stored calendar time (quiet after an edit, a named wait's deadline, the claims window, a hold's end, the idle bound, the yield bound, the drain time) still move with a clock change, as on 0.1.519; the pinning test shows it; nothing here makes them worse. Proposed row 011-377 holds them.
3. **Row 011-372 kept.** The rebase keeps every decision on the step's one reading (`step-reading.test.ts` unchanged from main); the `slow-tier.ts` hunks keep both rows.
4. **Behaviour preserved** apart from wake timing after a clock change: no tier, order, width, status payload, note text, CLI output or key change. The eight files outside the brief (`hold.ts`, `command-hold.ts`, `runner-work-bound.ts`, `slot-records.ts`, `yields.ts`, `slow-release.ts`, `slow-tier.ts`, `record.ts`; accepted by the coordinator) change only how a wait is stated.
5. **The coordinator's test commit** is right and leaves no process or timer behind.

Coordinator at the candidate: lint, typecheck, `check:version origin/main`; `key-format` 12/12 alone at load 85 (it failed once as a whole file in a parallel run at load 70); `version-sensitive`, `wakes`, `clock-port`, `step-reading`, `one-loop-source`, `step` 97/97; `writer-turns` and `sigkill-children` 3/3. Worker: lint, typecheck; 112 tests of the scheduler clock files; model test 8/8 at load 7.9; 35 pending scheduler files run directly, 181 tests. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave no daemon or process behind. Write `reviews/0.1.523.md` and commit it on your branch.
