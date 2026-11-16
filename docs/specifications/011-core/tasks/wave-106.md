# Wave 106: the flakiest scheduler tests on the virtual clock (rows 011-363, 011-367 with 011-360)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-15 (rows 011-358 to 011-371). Evidence: `../quality/2026-11-15-card-7.md` section 4 (flake history, the files, what a move gains and what it does not) and its rows R5 and R7. Base: main with 0.1.518 (`step-live.ts`, every owner on the scheduler's loop and clock). Test files only: no product code changes, so no version raise unless a fixture needs one (say so first).

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends. The host is loaded by another project tonight: state the one-minute load with every timing you report. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`, every file under `src/` (a gap there is a message to the coordinator with a failing case).

The pattern (from row 011-353's notes and `model-harness-clock.test.ts`): the harness gets `clock: "virtual"`; each `expect.poll`, `pause(SETTLE_MS)` and `idle()` becomes `clock.advance(...)` and `await scheduler.rest()`; a "nothing happened" settle becomes an exact assertion after `rest()`. The runner's own sleep stays real (`catch-up-fixture.ts:186-192`), and so do card 9's busy-store timers. Cases keep their meaning; a case dropped or changed in meaning is named in the notes with the reason.

## W1: row 011-363

Use /worker. Shape: slice. Effort medium.

Files: `tier-yields-overrun`, `tier-yields-kept` (row 011-301: say whether the wait was its cause), `handover-batches` (case 4 is board row ci-43589305691's flake; it failed again on 0.1.518's CI), `tier-yields-claim`, `tier-yields-claim-ends`, `retry-slow-lane`, and the fixtures they need (`tier-yields-fixture.ts`, `batch-fixture.ts`, `tier-yields-claim-fixture.ts`).

Done when: row 011-363's done-when holds; each file passes 3 of 3 (Squeal or direct, load stated); `tasks/011-363/notes.md` gives each file's wall time before and after.

## W2: row 011-367, with row 011-360

Use /worker. Shape: slice. Effort medium.

Files: `claims-fixture.ts` gains `clock: "virtual"` and `rest()` as `catch-up-fixture.ts` has them (default unchanged; 21 files use it), then `fresh-worktree-durations`, `slow-slot-fair`, `runner-part-bound` (row 011-360: say whether the move removes its flake; row 011-362 already put its bound on the scheduler's loop), `capacity-pool`, `busy-merge`.

Done when: row 011-367's done-when holds; row 011-360's cause is named in `tasks/011-367/notes.md` (fixed by the move, or a proven product cause filed as a proposed row with a failing test); each moved file passes 3 of 3, load stated; wall time before and after.

Both: lint, typecheck and `squeal status --wait 60000` on the changed paths; report pending checks as such.
