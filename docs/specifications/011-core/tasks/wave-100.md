# Wave 100: the decide/act splits (rows 011-354 and 011-355, card 7)

Coordinator 4c0bbe28, 2026-11-15. Approved by the human on 2026-11-15 ("Rows: Approve, land, start"; "Wake shape: 1 + lists, splits first in step"). Design: `../research/scheduler-step.md` ("The yield split", "Tests: replace, don't layer"; rows 4 and 5). Builds on 011-352 (`wakes.ts`, `step-events.ts` with `SchedulerEvent`, `rest()`; `tasks/011-352/notes.md`) and 011-353 (the model test on the virtual clock, which guards these splits; `tasks/011-353/notes.md`). W1 and W2 own no common file and run side by side; they may share one candidate.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. A `/tmp` copy calls `node_modules/.bin/vitest` directly, never `pnpm exec`. Run the model test (`test/scheduler/model-scheduler.test.ts`) once before finishing, when the one-minute load is below the CPU count. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION`. Behaviour preserved: no tier, order, width, status payload, note text, CLI output or key change; no timing change. A real bug found on the way is a proposed row with a failing test, not a fix here.

## W1: row 011-354, the yield check split into decide and act

Use /worker. Shape: slice. Effort high.

Outcome: `decideYields(at, trigger, view)` is a pure function over one reading that returns what today's yield check does, and `TierYields` only applies it.

Read: board row 011-354; the record's "The yield split"; `src/core/scheduler/yields.ts` (`TierYields`, `#decide` about line 265, `waitedFor` 367, `rankToBeat` 438, `boundOf` 515, the per-tier fold at 154-210); `scheduler.ts` `#cutTiers` (about line 536) and its five call sites; `test/scheduler/yield-check.test.ts`; review blocker R398 (0.1.296 B1) for the file-end filter.

Seam: `yields.ts`. Lead: move `#decide`, `waitedFor`, `boundOf` and `rankToBeat` behind `decideYields`, folding the cut marks tier by tier (a later tier reads the marks an earlier one set); it returns per-tier decisions, marks, bounds, history entries and the row. Then one exhaustive switch over `SchedulerEvent` in `yields.ts` decides which events reach the check: today's filter (`file-ended` only when the tier's inputs changed or it stands `named`), `held` reaches nothing, `yield-bound` and claims adopt stored results first. The five `#cutTiers` sites pass their event and filter nothing.

Owns: `src/core/scheduler/yields.ts`, the `#cutTiers` lines and its call sites in `scheduler.ts`, `step-events.ts` (only if an event kind is missing), new `test/scheduler/decide-yields.test.ts`, `tier-yields-bound.test.ts` and `tier-yields-clock.test.ts` (their direct `TierYields` cases go once the table covers them). Leave alone: `command-hold.ts`, `slow-release.ts` (W2), `tier-yields-kept.test.ts` (row 011-301), every other test file.

Done when: the row's done-when holds: the `decideYields` table passes, R398 a named row; every `tier-yields-*` test that drives a scheduler passes unchanged; the deleted direct cases are named in `tasks/011-354/notes.md`; the model test passes; `key-format` without a raise; lint, typecheck and `squeal status --wait 60000` on the changed paths pass.

## W2: row 011-355, the command hold's end and the slow lane close split into decide and act

Use /worker. Shape: slice. Effort medium.

Outcome: `decideHolds(entries, at, gone)` and `decideRelease(lanes, at)` are pure, and `CommandHold` and `SlowRelease` only apply them.

Read: board row 011-355; `src/core/scheduler/command-hold.ts` (`check`, the wake at the earliest `until`) and `slow-release.ts` (`#idleLanes`, `#dueAt`, the close); `scheduler.ts` `commandHold()` (prune in a transaction, cancel held tiers, close lanes, or pump); `test/scheduler/command-hold*.test.ts`, `slow-release*.test.ts`.

Seam: `command-hold.ts` first. Lead: `decideHolds` returns which holds ended, which stay with their next `until`, and what to do (prune, cancel held tiers, close lanes, pump); `CommandHold` applies it in today's order. Then `decideRelease`: which idle lanes close now and the next due time.

Owns: `src/core/scheduler/command-hold.ts`, `slow-release.ts`, the `commandHold()` lines of `scheduler.ts` only if the apply needs them, new `test/scheduler/decide-holds.test.ts` and `decide-release.test.ts`, `command-hold.test.ts` and `slow-release.test.ts` (their timer cases go once a table covers them). Leave alone: `yields.ts` and the `#cutTiers` lines (W1), every other test file.

Done when: the row's done-when holds: both tables pass; `command-hold-slow`, `merge-hold*` and the slow-release scheduler tests pass unchanged; the deleted timer cases are named in `tasks/011-355/notes.md`; the model test passes; `key-format` without a raise; lint, typecheck and `squeal status --wait 60000` on the changed paths pass.
