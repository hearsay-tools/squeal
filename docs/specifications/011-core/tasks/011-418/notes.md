# 011-418: a narrow backlog tier is short

Worker d3753e2c, wave 125 W2, 2026-11-20. Shape: slice. Brief: `tasks/wave-125.md` W2. Source: `research/run-width-design.md` section 2 and recommendation 2, arm (c+d); the VM-only patch `research/probes/run-width-design/c-narrow-short-tier.patch`.

## What changed

- `backlog.ts`: `shareBudget(budget, workers, full)`: the budget times `min(1, workers / max(1, full))`; `full` `null` (no pool) keeps the budget whole.
- `tier-pick.ts`: `Shape.budgetAt(workers)`; `Shape.budget` is `budgetAt(offer)`. A backlog tier's budget scales; a batch's tier (`batchBudget`, C15) keeps its whole budget, as in the probe patch.
- `tier-width.ts`: `PickWidth.budget` became `budgetAt`. The trim at a grant below the offer uses `budgetAt(grant)`, the grant's share.
- `tier-plan.ts`: `PlanAsks.fullWidth(): number | null`.
- Outside W2's listed files, one field each (none is W1's or W3's; the coordinator was told, message f9cd8292): `tier-live.ts` (`fullWidth: () => context.capacity?.fullWidth() ?? null`), `tier-pass.ts` (passes `budgetAt`), `yield-view.ts` (`fullWidth: () => null`: the yield model asks no pool), `scheduler/capacity.ts` (`TierCapacity.fullWidth()`).
- Tests: `test/scheduler/tier-plan-share.test.ts` (new); `test/scheduler/tier-plan-table.ts` gained `fullWidth`.

Type changes, all additive except one: `PlanAsks.fullWidth` (new required member: every `PlanAsks` implementer must give it; there are three, all updated), `Shape.budgetAt` (new), `TierCapacity.fullWidth` (new), `PickWidth.budget` replaced by `PickWidth.budgetAt` (internal to `tier-pass.ts` / `tier-width.ts`).

## A decision the brief did not settle: the full width

The brief says "the offer's share of the background ceiling". I scale by the share of the **full width**: the most workers a backlog tier of this daemon may get, `min(background ceiling, capacity.hostSlots, the project's slots)`. Reason: when the slots are below the ceiling, the offer can never reach the ceiling, so with the ceiling alone every tier is cut, also one offered all the slots. Example: `hostSlots: 4` on 24 CPUs (ceiling 18): every backlog tier would get 4/18 of 120 s = 27 s although 4 workers is the widest it can ever run. The wall-budget tests (`test/scheduler/backlog-wall.test.ts`, 64 CPUs pinned, 4 slots) failed three cases for this reason before the change. With the defaults (`hostSlots` CPUs − 1, share 0.75) the ceiling binds from 4 CPUs up, so the brief's numbers hold: 12 CPUs, ceiling 9, offer 1 → 13.3 s.

The full width is a fixed number per daemon (read at `TierCapacity` construction). It does not follow other daemons' fair shares: with two daemons each fair share is about 4.5 of 9, so each tier selects about 60 s. That is the research arm's behaviour (its patch used `floor(CPUs × 0.75)`); a share of the fair share would not shorten a tier whose daemon simply shares the host.

The checkpoint kind (`squeal run --all`) is gated by the slots, not the ceiling; its offer can pass the ceiling, and the share is at most 1, so it is not cut.

## Done-when as tests (`test/scheduler/tier-plan-share.test.ts`)

| Done-when | Test | Red on the old code |
|---|---|---|
| 1 of 9 selects at most about 13 s | 100 files of 2 s, offer 1, full width 9: 6 files (12 s); without a pool 60 files | yes |
| 9 of 9 selects as today | 20 s files at offer 9: 46 files, the same paths as without a pool; offer 11 above full width 9: as unscaled; fractional ceiling 6.75 with offer 7: whole | no (unchanged by design) |
| a grant below the offer trims by the grant's share | offer 9, 200 picked; `atGrant(1)` 6 files (old code: 60), `atGrant(3)` 58, `atGrant(9)` 200 | yes |
| a file with no known duration still makes progress | a 60 s file at offer 1: taken (first round); offer 0: one file; unknown durations: at least one; `atGrant(1)` of 60 s files: one | yes (the trim case) |
| batch tiers unchanged | a batch at offer 2, full width 9: same files and trim as without | no |
| `shareBudget`, `TierCapacity.fullWidth` | unit cases; 12 CPUs / 11 slots → 9, share 0.5 → 6, 64 CPUs / 4 slots → 4, project slots 2 → 2 | yes (new functions) |

Red check: with `shareBudget` forced to return the whole budget, 4 of the 8 tests failed (the 1-of-9 case, the grant trim, the progress case's trim, `shareBudget`).

## Checks run

- `pnpm run typecheck`: pass. `pnpm run lint` (biome): pass, no fixes.
- Direct: `timeout 900 pnpm exec vitest run --maxWorkers=2` over the 101 test files of `test/scheduler`, `test/capacity` and `test/integration/capacity-project.test.ts` that name capacity, backlog, `BacklogWall`, the tier plan or the wall fixture: 101 files, 573 tests passed.
- `grep` of `test/e2e` for the changed paths: no match.
- Squeal (`squeal status --wait`, revision 13 = commit `ad17af0cc`): the three `backlog-wall.test.ts` failures of the first version went FAIL → PASS; 200 affected files current and passing, 998 of 1,198 still queued when the wait ended (the changed files are read by most of the suite). No known failures in the worktree.
- Benchmark: not run (the coordinator runs `ref,wt-3,load-50` for W1 to W3 together).

## What the next one must know

- A tier of files with no known duration is not shortened: such a file counts 0 against the budget (C4 step 5), so a narrow tier of unknown files still takes up to `runner.backlogTierSize`. Out of scope here; a fresh store's first backlog is the case.
- The research's tail cost of arm (c+d) stands: more Vitest runs (about 1 s each) and more tier tails at small offers.

## Proposed C4 step 5 text

Replace "stays within 120 s, or half of `runner.timeoutMs` when that is less (amended 2026-10-19, ...)" with:

> stays within 120 s, or half of `runner.timeoutMs` when that is less, times the offer's share of the most workers a backlog tier may get, at most 1: the background ceiling's busy CPUs (021 D18), or `capacity.hostSlots` or the project's slots when fewer. So a backlog tier offered few workers selects little and its width is chosen again soon; one offered the full width is not cut, and a batch's tier (below) keeps its whole budget (amended 2026-10-19, row 001-366, `research/backlog-wall-budget.md`: summed as if serial, cezar's heavy files ran one per tier, 2,092 s against 507 s modelled under this rule at 23 workers; amended 2026-11-20, the human, card of coordinator 4abb5168 "Yes, with the fix", row 011-418, `research/run-width-design.md` arm (c+d): two daemons' narrow tiers ran 99 to 195 s at 1.7 to 3 workers; scaled, 25 s at most; 1 of 9 workers selects about 13 s).

And replace "A grant below the offer trims the picked tail to the same rule at the grant." with:

> A grant below the offer trims the picked tail to the same rule at the grant, its budget at the grant's share.
