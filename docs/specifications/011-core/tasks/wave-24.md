# Wave 24 of spec 011

Two rows on disjoint files, dispatched by coordinator 04a258b0 on 2026-10-23 from `int/w23` at c7e1d6a9c (0.1.277 in its gate, on top of main with 0.1.276). W1 is the scheduler's record path, which waited for 011-128 (in 0.1.277). W2 is the first code row of the focused-checks design the human accepted on 2026-10-23 ("Research + accept 011-135").

## W1: 011-131 with 011-103 slice 1 and 011-132 slice 4, the record of an ended run leaves `scheduler.ts`

Use /worker. Shape: slice (refactor, no behaviour change).

Outcome: `scheduler.ts` is under 1,200 lines, the record path lives in `src/core/scheduler/record.ts`, and one rule decides when a pass is sliced.

Read board rows 011-131, 011-103 and 011-132; `quality/2026-10-23.md` (slice 4 and the 011-131 row); `quality/2026-10.md` slice 1; `tasks/011-126/notes.md` and `tasks/011-128/notes.md`.

Order, one commit each: 011-103 slice 1 (one `Ledger` method that ends a tier's claim at `key` only, called from `#requeue` and `recordTier`); 011-132 slice 4 (`#handleBatch` takes a boolean and its pass goes through `#sliced`); then the move. Seam for the move: `EndedRun`, `PreparedRecord`, `Recorded`, `#prepared`, `#written`, `#slotsBusy` and `#recordLanded` to `#write` in `scheduler.ts`. A lead: one `Record` class that the scheduler builds with the context, lock, `BusyResume`, hold, `WarmUp`, `Withholds` and `TierYields` it already owns; `#fly` calls it, and `SlotRecords` gets its `record` from it.

Owns `src/core/scheduler/{scheduler,record,ledger,tiers,slot-records}.ts` and import lines in `test/scheduler/`. Not yours: `src/core/types/runner.ts`, `src/runners/` (W2), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds: `test/scheduler/busy-*.test.ts`, the 011-126 and 011-128 tests and the withhold tests pass unchanged; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted); `test/daemon/` run directly with `env -u PLUGIN_ROOT -u PLUGIN_DATA` (row 011-127). Paste the output in your summary.

## W2: 011-144, focused checks R1: the runner contract

Use /worker. Shape: slice.

Outcome: each runner adapter can run only the checks of a file whose full name holds a given text, and reports only those, with no scheduler change.

Read board row 011-144; `tasks/011-135/design.md` sections 3 and 8 (R1); spec 011 C14, 013 V4, 003 D5 and 007 D6 as amended 2026-10-23.

Seam: `RunOptions` in `src/core/types/runner.ts`. A lead: add `checks`, the texts per test file (a `TestFileRef`, matched as `run` matches its files), and `RunnerAdapter.focuses`, then the Vitest per-specification `testNamePattern` and its post-filter, then node:test's `--test-name-pattern`, then the pytest deselection hook in `squeal_pytest`.

Owns `src/core/types/runner.ts`; `src/runners/vitest/`, `src/runners/node-test/run/` and its report reader, `src/runners/pytest/`; their tests; `tasks/011-144/`. Not yours: `src/core/scheduler/` (W1), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds with real runner processes for all three runners, `test/keys/key-format.test.ts` says whether the key format moves (it should not), and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary.
