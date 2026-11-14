# Wave 95: the tier plan (rows 011-346 to 011-349)

Coordinator aaf51267, 2026-11-14. Card 6 of the architecture review of 2026-11-12, approved by the human on 2026-11-14 ("Rows: Approve, land, start"). Design: `research/tier-plan.md`. 011-346 runs first and alone; 011-347 to 011-349 follow after it lands, in W2 and later sections of this file.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION` (stop and ask if key-format asks for a raise).

## W1: row 011-346, the tier plan and its act step, behaviour preserved

Use /worker. Shape: slice (a move that changes nothing a user sees). Effort high.

Outcome: `selectTier` becomes a wrapper over `startNext(context, ledger, planTiers(view, asks))`, with no self-call, and the pump's beside and slot retries become plan candidates.

Read: board row 011-346; `research/tier-plan.md` whole (the interface is in "Coordinator's calls"; follow it); `GLOSSARY.md` (Tier, Tier plan, Queue view, Admission, Lane, Runner traits); `research/admission.md` (`admit()`, `checkTurn`); `research/runner-traits.md`; `test/keys/validity/compare.test.ts` and `reach.test.ts` before any edit.

Seam: `selectTier` (`src/core/scheduler/tiers.ts:260-497`), `#besideTier` and the slot loop in `src/core/scheduler/scheduler.ts` (~1100-1120, ~1307). Lead: first write `test/scheduler/tier-plan.test.ts` with a `view(rows)` builder and a table `PlanAsks` that logs calls; pin today's order on the six self-call cases before moving code. Then move one self-call at a time, the 7 `selectTier` test files green after each.

Owns: new `src/core/scheduler/tier-plan.ts` (and `tier-start.ts` if you put the act step there), `tiers.ts`, the pump parts of `scheduler.ts`, `slots.ts`, `quiet.ts` and `promoted-tier.ts` as the move needs, new `test/scheduler/tier-plan.test.ts` and an act test file. Leave alone: `queue.ts` and `promotions.ts` (011-347), `yields.ts` and `yield-sooner.ts` (011-348), `slow.ts`, `groups.ts`, `slow-tier.ts`, `record-tier.ts`, `src/core/code/gate/`, `executeTier`'s `background` and `TierPermits`, `tier-yields-kept.test.ts`, and the 7 `selectTier` test files (they must pass unchanged).

Hard rules: same tiers, order, widths, lookups, writes and commits in the same transactions; `ledger.probe` writes, so the plan never reads ahead of today's lazy order; `startTier`'s re-probe in `BEGIN IMMEDIATE` stays. A path whose order the plan cannot hold without a change: write it in the notes and ask me before changing it. A real bug you find: notes and ask; it gets its own row.

Done when: the board row's done-when holds; `tasks/011-346/notes.md` lists each write and its transaction, the quiet-wake clock difference, and the scheduler test cases the plan table repeats; lint, typecheck, `test/keys/key-format.test.ts` (no version raise) and `squeal status --wait 60000` on the changed paths pass. Report pending or unknown checks as such.
