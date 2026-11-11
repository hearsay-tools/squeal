# 020-17ab notes: the estimate and the order (D17.1, D17.2)

Worker fc234d55, 2026-11-11, on `cand/0.1.432` (`0bf414568`).

## Seam map

- `src/core/code/gate/estimate.ts` (pure): `estimateRun(runner, groups)`. A group is `{ width, seconds[] }`. Per group, the larger of the longest file and the sum over the width; groups add up. Unknown files count at the median of the runner's stored ones. No stored duration gives `seconds: null`. `median()` is shared with the order.
- `src/core/code/gate/order.ts` (pure): `loaderOrder(files, changed, { loads, seconds })`. One pass over each closure builds each changed path's loaders. Paths sort by summed seconds (unknown at the median, or 1 each with none stored, so the loader count), ties by path. Then the files that load no changed path, then the files whose closure is unknown.
- `src/core/code/gate/plan.ts` (glue): `planRuns(toRun, context)` reads each file's closure through the adapter, orders it, and groups it by width for the estimate. Width: `adapter.tierWidth?.(ref, grant)`, where the grant is Vitest's own default (`availableParallelism() - 1`, Vitest's `resolveMaxWorkers` outside watch mode) or node:test's `runner.tierSize`. The Vitest adapter's `tierWidth` caps the grant at the project's `maxWorkers`. A project 1 wide forms a group 1 wide, which sums: that is Vitest's sequential group.
- `src/core/code/gate/collect.ts`: `plan()` runs after `tellSelection` and before the loop. It does every runner's stored lookup (`storedBefore`), then `planRuns`, then calls `options.estimated` once. `knownBefore` takes the looked-up map as `at.stored` and keeps only the `prepare` branch.
- `src/cli/code-gate-durations.ts`: `storedDurations(root)` opens the main store read-only and gives `durationOf(results.newestForTestFile(ref)) / 1000`, at any key, as the daemon's bootstrap does for a miss. `null` with no store or another schema.
- `src/cli/code-gate.ts` opens the durations, passes `durations` and `estimated`, and closes them in `finally`. `src/cli/code-gate-text.ts` `estimateText()` writes the lines.
- Report: `Evidence.estimates`; `runs[].estimate` (`seconds`, `files`, `known`, `width`) in `report.ts` `runsOf`. `evaluate.ts` is unchanged.

## On 0.1.432 with the B2 repair and 020-17c (row 020-17 I)

Done as planned here. `collect.ts` now goes: select, `storedOf` (the repair's one lookup of the parts and the stores), `tellSelection`, `plan(picked, known, …)`, then per runner `preparedBefore`, the run of `planned.files[i]` less what `prepare` kept from running, and `tellRan` (020-17c's keep).
- `storedBefore` and `Planned` are gone. `preparedBefore` takes no `stored`.
- `plan` estimates and orders each runner's selected files less those `known` gives. So a file 020-17c kept and the next run reads back is not estimated (`test/cli/code-gate-keep.test.ts`, second case, reads both the selection line and `runs[].estimate`).
- A node:test entry whose `prepare` only the head declares (`not-at-base`) still counts in the estimate, as it counts as "to run" in the selection line (W5-R1 notes). Both can drop it together later, from `declaresPrepare`, with no run.

## Decisions the spec did not settle

- Two runners run in turn, so a runner's line is over the budget when the estimates up to it pass the seconds left; that line gives the ways out. An unknown estimate counts 0 there.
- `width` in the report is the widest group's width.
- Within one path's loaders, files keep the selection's path order (not shortest first).
- Unknown closures go last, as D17.2 says. Note: the evaluator counts a file with an unknown closure as a possible loader of every path, so while it has not finished, no path completes. Placing such files first would complete paths sooner; that would change D17.2.
- Widths are grouped by value. Two Vitest projects with different `sequence.groupOrder` and the same width merge into one group, which reads lower than two groups in turn. A project `maxWorkers` above the CPU default reads at the CPU default.
- The estimate line is printed even with no store ("the time is unknown"), as D17.1 says. Every gate run that runs a file now has one more stderr line.
