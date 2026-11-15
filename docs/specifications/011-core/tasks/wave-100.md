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

## R1 (W1 and W2): review of cand/0.1.514

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.514` at `353927ab5daa48625382f16b5e32808be76de0a0`; candidate CI run see `gh run list --workflow ci.yml --commit 353927ab5daa48625382f16b5e32808be76de0a0`. Range `8b04ac964..353927ab5daa48625382f16b5e32808be76de0a0`: worker a32a803e's two commits (row 011-355), worker 9e1d33bb's four (row 011-354), cherry-picked onto main without conflict, then the 0.1.514 raise and bundles. Read: board rows 011-354 and 011-355, this file's W1 and W2, `tasks/011-354/notes.md`, `tasks/011-355/notes.md`, `../research/scheduler-step.md` ("The yield split"), review blocker R398 (0.1.296 B1).

Check, each as proven, plausible or unverified:

1. **`decideYields` is today's check.** Pure over one reading; folds cut marks tier by tier; same decisions, marks, bounds, history entries and row as `#decide`, `waitedFor`, `boundOf`, `rankToBeat` did. The worker moved every decision before every abort (notes decision 4): prove or refute that no abort changes what a later tier reads.
2. **The event switch.** `yieldReach` is exhaustive over `SchedulerEvent` and holds today's filter (`file-ended` only when inputs changed or the tier stands `named`; R398 a named table row); the call sites filter nothing. The hold read in the check's own lock turn (`YieldView.held`, notes decision 1) keeps today's timing.
3. **`decideHolds` and `decideRelease`.** Pure; `CommandHold` and `SlowRelease` apply them in today's order; the transaction's second read keeps catching a writer between reads; no wake time moves (`wakeAt` keeps a past bound, notes decision 4).
4. **Behaviour preserved.** No tier, order, width, status payload, note text, CLI output or key change; no timing change.
5. **Tests.** The tables pin what the deleted cases pinned (each named in the notes); the kept scheduler-driving tests (`tier-yields-*`, `command-hold-slow`, `merge-hold*`, slow-release scheduler tests) are unchanged.

The coordinator's tree passed lint, typecheck, `check:version origin/main`, and a direct run of `key-format`, `version-sensitive`, the model test, the three new tables, `tier-yields-bound`, `command-hold`, `command-hold-slow`, `slow-release` (10 files, 96 tests, 16.9 s at load 2) at the candidate. Worker trees: 011-354 had 934 affected files current (930 pass, 4 bundle drift); 011-355 had its named files current, about 600 wider files unread. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; a `/tmp` copy calls `node_modules/.bin/vitest` directly, never `pnpm exec`. Write `reviews/0.1.514.md` and commit it on your branch.

## R2 (W1 repair): re-review of cand/0.1.514 after `reviews/0.1.514.md`

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.514` at `8bf9b4d8de1c595926a0b01e86ac409e0e34cd7b`; candidate CI run 43736147805. Rebuilt on main `6a4d6cd84`: row 011-355's two commits and row 011-354's four (unchanged), then worker 9e1d33bb's repair (`fc69690d3`, `677f4e200`, cherry-picked), then the 0.1.514 raise and bundles. Narrow: the repair, against `reviews/0.1.514.md` B1. Read that review and `tasks/011-354/notes.md` "Repair after review 0.1.514".

Check, each as proven, plausible or unverified: `decideYields` writes nothing (the review's three reproductions pass as table rows; look for any other write it still reaches); `TierYields.check` applies the returned bookkeeping (claim first-seen, waiting flag, expiry/removal, focused pruning) so the claim timeout and pump wake rules behave as before, in today's order relative to the decision (the worker replays it before deciding: prove or refute that this gives the same decisions as the old in-decision writes); the new read-only reads (`Claims.peek`, `readClaim`, `FocusedEntries.peekWaiting`, `readFocused`) leave the writing ones unchanged; nothing a user sees changes. Worker evidence: 34 table cases, 32 named files current with no failure, model test 12.9 s, 936 affected current (4 bundle drift). Coordinator: lint, typecheck, `check:version`, `key-format`, `version-sensitive`, `decide-yields`, model test (60 tests) at the candidate. Host policy as in `wave-85.md`; never the real `HOME`. Write `reviews/0.1.514-r2.md` and commit it on your branch.
