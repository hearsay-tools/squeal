# Wave 37

From main after 0.1.307 (`e13894aed`), 2026-10-25. Two tests-only rows on disjoint files: the step-down test's fixture race (W1) and the model-based scheduler test (W2). Neither changes `src/`, so they land with the next release that has a product change, or alone as tests.

## W1: 011-203, `step-down-lanes.test.ts:209` and the fixture's edit inside the run

Use /worker. Shape: repair. Row 011-203 in `docs/board.md`.

Outcome: the `edit` case of `test/daemon/step-down-lanes.test.ts` passes whether or not the fixture's edit falls inside the run's window, and still fails when the cancel names the wrong cause.

Read the row; main CI 40175055145 attempt 1, Node 22 shard 3/3 (the received message); spec 011 C4's cancel causes (row 011-56) and C12 (the 001-159 note); the case at `:159-212`.

Seam: the assertion at `:209`. First edit, offered as a lead: compare the first line of each cancel message with `cancelled("step-down")`. Either way, say whether the note is right for this fixture: the edit was written before the run started.

Owns `test/daemon/step-down-lanes.test.ts` and helpers under `test/daemon/` that only it uses. Not yours: `src/`, other tests, the board, spec text, `status.md`, bundles, version. If the note is wrong for a write made before the run, send one request with the evidence; do not change `src/`. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-195, a model-based test of the scheduler in the suite

Use /worker. Shape: slice. Row 011-195 in `docs/board.md`.

Outcome: the suite has a model-based scheduler test that finds 016-18's two defects on old code and passes on main.

Read the row; `docs/specifications/016-extensions/research/model-scheduler.md` (findings 1 to 4, recommendations 1, 3 and 4, open question 1); the probe `016-extensions/research/probes/model-scheduler/model.probe.ts` and `results/directed.md`. Port the probe; do not run `run.sh` or `replay.sh`. Spec 011 C4 step 5 and C15 Rank and Lifetime; `status.md`'s lines for 011-193, 011-194, 011-196 and 011-202.

Seam: a new `test/scheduler/model-fixture.ts` beside `test/scheduler/catch-up-fixture.ts`. First edit, offered as a lead: the model, the fake runner and the virtual clock, reusing `catchUpRepo` and `catchUpSide`; then one `it` per invariant group A to F over a fixed seed list.

Owns `test/scheduler/model-fixture.ts`, `test/scheduler/model-scheduler.test.ts`, `tasks/011-195/`. Not yours: `src/`, other tests, `016-extensions/`, the board, spec text, `status.md`, bundles, version. A defect the model finds on main becomes a request to me with its shortest sequence; do not fix `src/`. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
