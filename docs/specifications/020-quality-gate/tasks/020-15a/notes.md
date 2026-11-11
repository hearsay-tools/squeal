# 020-15a notes: scope by check group in `squeal code --base`

Worker 34dd50e3, 2026-11-11. Spec D14.1 to D14.3. For a reviewer, the coordinator's merge with 020-16b, and 020-15b.

## Seam map

- **Policy key.** `types/policy.ts` `Policy.gate.groups` (default `null`). `daemon/policy-gate.ts` `GATE_SHAPE` checks only the type (a list of strings, or `null`), spread into `daemon/policy.ts` `SHAPE`. Whether each name is a test group is checked at the base by the gate, not by the daemon (D14.6).
- **Base read.** `gate/policy.ts` `loadBasePolicy` adds `BasePolicy.scope` (`ScopeBase`: every resolved group at the base, and `gate.groups` as kept) from `scope.ts` `readScope`. Its problem lines join the base policy's problems, so `cli/code-gate.ts` `inventoryOf` prints them on stderr as before. `BasePolicy.scope` is optional so test literals stay valid; `resolveScope(undefined, …)` means the default groups.
- **Scope.** `gate/scope.ts` is pure: `readScope`, `resolveScope` (the `--group` usage errors), `placeFile` (019's `groupOf` with the gate runner mapped to its `checks` key), `tallyScope` (each runner's split and the left-out group counts), `leftOutLoaders`.
- **Collect.** `CollectOptions.scope` (a `GateScope`). `select()` takes the tally and a `leftOut` sink, and splits each runner's selection after it is complete. `leftOutFiles()` reads each left-out file's closure after the runs, before the adapters close. `Evidence.scope` (`ScopeEvidence`: in-scope groups, left-out groups, left-out files with their closures) is present only when a scope was given. Left-out files never reach `options.stored` (stores, parts).
- **Rule.** `rule.ts` `RuleInput.leftOut?` (count; absent for the daemon). `completenessOf`: no in-scope loader and a left-out one gives `left-out`, not `no-loader`. `leftOutOf`: a complete in-scope violation by CRAP with a left-out loader gives the state `incomplete`/`left-out`, while `evidence` keeps the violation and `completeness` stays `null`.
- **Evaluate.** `Context.leftOut(path)` (`leftOutLoaders` over `evidence.scope.files`), kept out of `pathEvidence()` and `standing()`, which 020-16b edits. `loaders.leftOut` is present only when non-empty. `base.policy.gateGroups` only when `policy.scope` is set; `report.scope` only when `evidence.scope` is set, after `budget`.
- **Exceptions (agreed with the coordinator, request cc11aaad).** `exceptions.ts` `stateOf()`: the early return needs the evidence to be incomplete too, and an uncovered evidence violation returns the row's own state. Every case without a left-out loader is unchanged.
- **CLI.** `code-gate-args.ts` `--group <name>...` (a listed option, as `--test`). `code-gate.ts` resolves the scope after the inventory and passes it to the collector: 3 lines. `code-gate-text.ts`: `GAP_WORDS["left-out"]` and the verdict line's `leftOutText`.

## Decisions the spec did not settle

- A left-out file whose closure is not known counts as a left-out loader of every changed path, as an in-scope file with an unknown closure counts as one that may load. It cannot make a pass; it can only turn a CRAP violation into `left-out`.
- `gate.groups` whose names were all dropped stays an empty list: nothing but `--test` files runs, and the verdict reads `incomplete`. It does not fall back to the default.
- A `--group` that names a group already in scope is accepted, and the group keeps its first source.
- `scope.leftOut` lists the out-of-scope test groups that own a listed test file. `files` counts them over every runner; `selected` counts the selected ones that did not run (a `--test` file that ran is not counted). A run with no changed path and no `--test` file opens no runner, so its `leftOut` is empty.
- The verdict line names only groups with `selected > 0`, as one sentence each after the counts.
- Stored or part evidence of a left-out file is not read: the scope decides what counts, whatever the stores hold.

## For whoever continues (020-15b)

- The pre-run print's data is already in `select()`'s result: the tally knows each runner's in-scope files by group only through `placeFile`. A `selected(summary)` callback after `select()` can call `placeFile` on `selected[i]` for the per-group counts, and read `tally.evidence([])` for the left-out groups before closures are read.
- `collect.ts` is about 395 lines (348 before this row).
