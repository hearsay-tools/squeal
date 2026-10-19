# 001-366 notes (W1 of wave 3, 2026-10-19)

Slice: a backlog tier fills one round, then 120 s of estimated wall time (spec 011 C4 step 5 as amended 2026-10-19; `research/backlog-wall-budget.md`, Recommendation).

## The seam map

- `src/core/scheduler/backlog.ts`: `BACKLOG_TIER_BUDGET_MS` is 120 000; `backlogBudget` unchanged (`min(B, timeoutMs / 2)`). `wallEstimate(sum, longest, W)` is list scheduling's bound; `BacklogWall.take(durationMs, width)` takes a file while the tier holds fewer than W files (the round) or the estimate stays within the budget. W is the narrowest width of the files taken so far, so a project with a lower ceiling narrows the estimate, never widens it.
- `src/core/scheduler/tiers.ts` `selectTier`: before the loop, `offer = capacity.offer(size)`, or `defaultHostSlots()` without a pool (what Vitest and node:test run without a grant). Each pick asks `tierWidth(context, ref, offer)` (`RunnerAdapter.tierWidth`, absent: the grant). After the loop the pool is asked for `widest` = `min(files, the widest file's width at files)`, so a node:test tier asks for `min(files, runner.tierSize)`; the lease is wrapped in `widthLease` so `startTier`'s `shrinkTo(files)` keeps and states at most that width. A grant below `min(width, offer)` re-runs the rule at the grant and splices the tail; the spliced files were never removed from the queue, so they stay queued in order.
- `src/core/capacity/pool.ts`: `PermitPool.offer(want, lane)` is `acquire`'s share arithmetic (`#share`, shared by both) without taking. It reads marks only: permits taken since without a mark, or the reserve left for an older waiter, can make the grant smaller, which the trim handles.
- `src/core/scheduler/capacity.ts`: `TierCapacity.offer` (the pool failing: `want`), `widthLease`.
- `RunnerAdapter.tierWidth(testFile, grant)` (additive, `src/core/types/runner.ts`). Answered by the Vitest adapter (`Widths.of(project, grant)`: `tierWidth(grant, ceiling)`, at least 2, a ceiling of 1 kept; no instance yet: the grant) and by `createNodeTestRunners` / `createPytestRunners` through a new `RecoveringRunnerOptions.tierWidth` (`runner.tierSize`, read per call, before the adapter is built). Passed through by `composite-runner.ts` (the file's owner), `runner.ts`, `escaped.ts`, `slow-instance.ts` (the fast instance). Those four wrappers are outside the brief's named seams; each change is the one-line pass-through `slowWidth` already has.

## Tests (the research's "Slice done-when")

| # | Test | Red on main |
|---|---|---|
| 1 | `test/scheduler/backlog-wall.test.ts` "runs 16 heavy files in one tier when the pool offers 23 workers" | yes: tiers 4, 3, 2, 2, 2, 2, 1 |
| 2 | same file, "fills one round of 4, then keeps each tier's wall estimate within 120 s" | no: today's serial rule also gives 4 first; the new rule's bound is asserted |
| 3 | same file, "trims a tier granted less than offered…" (18 permits held without a mark: offer 23, grant 5) | yes: 4 files against 5 |
| 4 | `test/runners/vitest/width.test.ts` "the backlog tier's width it reports (001-366)" | yes: no hook |
| 5 | `backlog-wall.test.ts` "holds at most a node:test lane's width in permits…" (9 files of 5 to 20 s; the heavy 60 to 150 s ones only fit 4 at W = 4) and `test/daemon/tier-width.test.ts` (node:test and pytest answer `runner.tierSize`, the composite routes) | yes: 3 files on main |
| 6 | `backlog-wall.test.ts` "still takes 200 light files a tier…" | yes: today 200, 195, 129, 76 (600 files of 0.1 to 3 s sum past 300 s serially) |
| 7 | `test/scheduler/backlog-wall-latency.test.ts`: real node:test through the daemon's runner, `timeoutMs` 8 s so B = 4 s, eight files sleeping 1.2 to 2.4 s; measured a tier of 6 files and the edit current after 3.5 s against a 7 s bound, load 9.9 on 24 | partly: the latency bound holds on main too (tighter serial budget); the tier of ≥ 4 files (one round) fails on main |

The Vitest half of 7 (an edit cancels a backlog tier within its graces) is `backlog-tiers.test.ts`'s existing cancel test; without a pool its 200 files still fit one tier under the new rule, so it still exercises a 200-file cancel. Not duplicated.

`test/scheduler/wall-fixture.ts`: a lone daemon over a real store and a real pool directory with a fake runner whose results report fixed durations and whose runs end at once; `backlog()` is the baseline then `requestFullSuite({ force: true })`. `spread(n, from, to)` interleaves with `i * 7 mod n`, a permutation only when 7 does not divide n.

## Decisions the spec did not settle

- Without a pool (tests, a pool that fails before `offer`) the offer is `defaultHostSlots()`, CPUs − 1, Vitest's and node:test's own run-mode default; a pool that throws in `offer` gives `want`, as `take` then runs the tier ungranted.
- A tier mixing Vitest projects of different ceilings is estimated at the narrowest; the ask is the widest. `sequence.groupOrder` groups are not modelled (the research's open question).
- The trim compares the grant with `min(width, offer)`, not the offer alone, so a node:test tier asking 4 of an offer of 23 is not "granted less".
- `src/core/types/policy.ts`'s `backlogTierSize` comment now says "estimated wall time"; one line, outside the named seams.

## For the next worker

- `KEY_FORMAT_VERSION` is 14 with this slice's guard hash: `squeal--v0.1.222` carries 13, and every `src/` change is guarded. Re-pin 14 in place at integration if other rows also changed guarded sources.
- `observe-fidelity.test.ts` (Vitest) and `run-reads-fidelity.test.ts` (node:test), task 001-390, fail under the Squeal daemon (17 of 17 results across worktrees and commits, a1da5df included) and pass under `npx vitest run`; not this slice's.

- The bundles (`plugins/*/dist`) are not rebuilt: the four bundle drift tests fail until the coordinator builds.
- R2 (011-21, streaming lanes) replaces the tier barrier; this rule is what it is measured against.
