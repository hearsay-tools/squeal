# Wave 97: one clock for the scheduler (row 011-351, card 7)

Coordinator 4c0bbe28, 2026-11-15. Approved by the human on 2026-11-15 ("Rows: Approve, land, start"). Design: `../research/scheduler-step.md` (decision 1; "Coordinator's calls", "The clock port"; row 1). Terms: `GLOSSARY.md`, "Deciding what runs next".

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION`.

## W1: row 011-351

Use /worker. Shape: slice. Effort medium.

Outcome: every clock reading under `src/core/scheduler/` comes from one clock port given in `SchedulerOptions.clock`, with behaviour preserved.

Read: board row 011-351; the design record's "The clock port", "Timing differences" and "Key format" paragraphs; `test/keys/validity/compare.test.ts` and `reach.test.ts` (they reach `claims.ts` and `promotions.ts` at run time).

Seam: new `src/core/scheduler/clock.ts` (port: `now()` and one arm/disarm of a timer; host adapter reads the given `now` or `Date.now`, looks `setTimeout` up per call, clamps the delay to 2^31-1 ms, unrefs). Lead: add the port and `SchedulerOptions.clock` (`now` stays as shorthand for the host adapter over it), then replace the reads one by one: `performance.now` in `claims.ts:167-169`, `slot-records.ts:83-86`, `slow-tier.ts:256,590,809`; `Date.now` defaults in `mutex.ts:25`, `promotions.ts:88`, `keying.ts:362`, and the `options.now ?? Date.now` sites in `scheduler.ts`. A difference once measured on the steady clock is clamped to at least 0. A decision that already takes `now` gets its caller's one reading. Do not move any timer to the port yet (011-352); the arm/disarm exists for it.

Virtual adapter: `test/helpers/virtual-clock.ts` (`now`, `advance(ms)`, runs due timers in time order). Do not touch `test/scheduler/model-clock.ts` (011-353 replaces it).

Owns: `src/core/scheduler/{clock,claims,slot-records,slow-tier,mutex,promotions,keying,scheduler,options}.ts` (only the clock lines of the last three), `test/helpers/virtual-clock.ts`, new tests under `test/scheduler/`. Leave alone: `busy-resume.ts`, `src/core/store/busy.ts`, `local-permits.ts`, `src/core/capacity/` (cards 9 and 10), `record-tier.ts` (card 1), every existing scheduler test file.

Done when: the row's done-when holds: `grep -rn "performance\.now\|Date\.now" src/core/scheduler/` lists only `clock.ts` (paste it in the notes); a virtual-clock table pins the slow lane's load budget and the claims window; existing scheduler tests pass unchanged; `test/keys/key-format.test.ts` passes without a raise, and `compare.test.ts`, `reach.test.ts` pass. `tasks/011-351/notes.md` names the three owners that moved off the steady clock (the accepted timing difference) and any decision the record did not settle. Lint, typecheck and `squeal status --wait 60000` on the changed paths pass; report pending or unknown checks as such. A real bug found on the way is a proposed row with a failing test, not a fix here.
