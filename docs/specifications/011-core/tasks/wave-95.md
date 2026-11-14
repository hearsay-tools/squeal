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

## R1 (W1): review of cand/0.1.507

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.507` at `88bbe9cc0ef2fd4d536b87d03a2b801d8abdc45c`; candidate CI run 43648053854. Range `77089219d..88bbe9cc0`: five commits of worker d2588e46 (`25262082e..a32818f03`, cherry-picked from `e094f8efd..dedec036f` without conflict), then the 0.1.507 raise and bundles. Behaviour to compare against: `77089219d`. Read: board row 011-346, `research/tier-plan.md`, `tasks/011-346/notes.md`, this file's W1.

Check, each as proven, plausible or unverified:

1. **Same order, same writes.** For each of the six former self-calls (notes' table), the beside stage and the slot stage: the same tiers start, in the same order, at the same widths, with the same `ledger.probe`, `queue.remove`, `touch`, `applyResults` and `commit` calls in the same transactions. Look hardest at the generator's resume points, a refusal with a lease (release, then commit, then the next pass), and `afterUnstarted` re-planning the same pass.
2. **No read ahead.** The plan asks `lookup`, `held` and `offer` lazily, no earlier and no more often than `77089219d` did; `startTier`'s re-probe in `BEGIN IMMEDIATE` is unchanged.
3. **Leases.** Every lease is released on every path (refusal, narrower grant, throw, unstarted) until a tier owns it.
4. **The pump.** `#besideTier` and the slot loop are gone; the claim, quiet and pool wakes fire when they did; `capacity.refused()` still clears its flag each look; admission's `checkTurn` holds in the slot stage.
5. **The worker's calls** (notes, "Decisions the design did not settle"): `Idle.wakeAt` per reason, not the earliest; extra `PlanAsks`; a slot as a grant of 1; the one clock reading per plan and the quiet wake's later reading. Say whether any one changes what a user sees.
6. **Scope**: only `src/core/scheduler/`, `test/scheduler/`, the notes, the version and bundles; no key change (`test/keys/key-format.test.ts` passes without a raise); the 7 `selectTier` test files unchanged.

The coordinator's tree passed lint, typecheck, `check:version`, `key-format` and `version-sensitive` (19 tests) at the candidate; the worker ran the 7 `selectTier` files, the new plan and act tests, and 58 real-scheduler files directly (notes). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`. Write `reviews/0.1.507.md` and commit it on your branch.

## W2: rows 011-347 and 011-349, one clock reading orders the queue; the old entry point goes

Use /worker. Shape: repair (011-347, test first), then finish (011-349). Effort medium. Starts after 011-346 lands; runs beside W3, one candidate for both.

Outcome: one decision orders the queue at the plan's `now`, and `selectTier` is gone with its plan and act cases moved to the plan table and the act tests.

Read: board rows 011-347 and 011-349; `research/tier-plan.md` ("One clock reading", "Tests: replace, don't layer"); `tasks/011-346/notes.md` ("For 011-347, 011-348 and 011-349" and the table of cases the plan repeats); `test/keys/validity/compare.test.ts` and `reach.test.ts` before any edit to `queue.ts` or `promotions.ts`.

Seam for 011-347: `Promotions.rankOf` (`promotions.ts:145`) and `queue.ts:548-563`; the live view's `ordered` and `orderedBatches` (`tier-live.ts:60-61`). First edit: a test of a promotion that expires between two of the queue's clock readings in one decision; then pass `view.now` through. If it cannot fail today, say why in the notes and pin it in the plan table.

Seam for 011-349: the `selectTier` wrapper in `tiers.ts`; move its doc comment to `tier-pass.ts`. `batch-select`, `focused-group-turn` and `promoted-tier-select` go whole; `backlog-quiet-select`, `catch-up-quiet-select`, `batch-busy-host` and `pool-wait` keep only their quiet-state, publishing and `PoolWaits` cases. Each moved case is named in the notes with its new row.

Owns: `queue.ts`, `promotions.ts`, `tier-live.ts`, `tiers.ts`, `tier-pass.ts`, `tier-pick.ts`, `test/scheduler/tier-plan.test.ts`, `tier-plan-table.ts`, `tier-start.test.ts`, the 7 `selectTier` test files. Leave alone: W3's files (`yields.ts`, `yield-sooner.ts`, `tier-plan.ts`, the yield tests); `scheduler.ts` except a `selectTier` import; every test that drives a real scheduler.

Done when: both board rows' done-when hold; lint, typecheck, `test/keys/key-format.test.ts` with no version raise, `compare.test.ts` and `reach.test.ts` pass; `squeal status --wait 60000` on the changed paths, pending reported as pending. Notes in `tasks/011-347/notes.md` and `tasks/011-349/notes.md`.

## W3: row 011-348, a yield asks the tier plan whether the waiting file starts sooner

Use /worker. Shape: slice, test first. Effort medium. Starts after 011-346 lands; runs beside W2.

Outcome: `TierYields`' "starts sooner" check asks `planTiers` over a view of the cut files and the waiting file only, and `yield-sooner.ts` is gone.

Read: board row 011-348; `research/tier-plan.md` decision 2; `tasks/011-346/notes.md` (decision 7, `Candidate.estimateMs`, and "For 011-348"); `yields.ts:350-395`; `yield-sooner.ts`; `test/scheduler/yield-sooner.test.ts`, `tier-yields-next-tier.test.ts`.

Seam: `startsSooner`'s call in `yields.ts:390`. First edit: a new `test/scheduler/yield-check.test.ts` that runs `startsSooner` and the plan (a yield view: no saved result, no claim, no pool; `slots` false, `beside()` null) side by side on every case of the two files and expects the same answer. A difference is a bug: stop, write it in the notes and ask me; it gets its own row with a failing test. Then switch `TierYields` to the plan and turn `yield-sooner.test.ts`'s cases into rows of the new file.

Owns: `yields.ts` (the check only), `yield-sooner.ts` (delete), `tier-plan.ts` and `tier-width.ts` (the estimate and a yield view, if needed; ask me before editing W2's `tier-pass.ts` or `tier-pick.ts`), a new `src/core/scheduler/yield-view.ts` if the view needs a home, `yield-sooner.test.ts`, the new `yield-check.test.ts`. Leave alone: W2's files; every `tier-yields-*` test (they pass unchanged; `tier-yields-kept.test.ts` is row 011-301's); yield events, timers and status (card 7).

Done when: the board row's done-when holds; every `tier-yields-*` file passes unchanged (run directly); lint, typecheck, `test/keys/key-format.test.ts` with no version raise; `squeal status --wait 60000` on the changed paths. Notes in `tasks/011-348/notes.md`.
