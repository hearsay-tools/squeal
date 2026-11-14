# Wave 1.5: repair of review 0.1.493

Review `reviews/0.1.493.md` FAIL on `cand/0.1.493` `d5d89179b`. Two repairs in parallel on disjoint seams, from the candidate head. The coordinator rebuilds the bundles and re-pushes the candidate; one re-review follows. Read the review in full first, then spec 022 D1 to D4 and `tasks/022-03/notes.md`. Verify with `squeal status --wait 60000 <changed-path>...`, lint, typecheck and `pnpm exec vitest run test/keys/key-format.test.ts test/version-sensitive.test.ts`. No full suite, no `pnpm run build`. Commit on your branch.

## 022-03r B1: CI export carries the run's loaded modules — repair

Outcome: a CI-recorded Vitest run keys a test file exactly as the daemon does when the file loads a module at runtime.

- Seam: `src/runners/vitest/ci-runtime/coverage.cjs:170` gets `batch.loaded` and drops it. Carry each file's loaded paths into its observed inputs before export keying (`src/runners/vitest/ci-record.ts`, `ci-runs.ts`, `src/core/ci/export-report.ts`). Use the same environment exclusion and the `observe.runtimeInputs` rule as `src/runners/vitest/observe.ts:198`. Keep the shared `DaemonKeying` path. Export no `loaded_modules` lists (spec non-goal).
- Owns: `src/runners/vitest/ci-*.ts`, `src/runners/vitest/ci-runtime/**`, `src/core/ci/**`, `src/runners/vitest/observe.ts` (to share the exclusion), their tests.
- Leave alone: `src/core/reach/**`, `src/cli/reach*.ts` (022-04r).
- Done when: the review's runtime-import probe is a test in the daemon/export parity suite, with coverage on: daemon, gate and CI keys are equal; setup files join neither closure; with `observe.runtimeInputs` off nothing joins.
- Use /worker.

## 022-04r B2: reach decides avoidance from graph facts, not route labels — repair

Outcome: the narrowing estimate counts a pair avoidable only when graph evidence proves every changed path is an import-graph input the list does not hold, and counts importers from graph edges.

- Seam: `src/core/reach/narrowing.ts:108` and `:168` use `reach.kinds`; `analyze.ts:250`; `pairs.ts:166` and `:188` give display precedence and an `import` fallback with no edge. Give narrowing explicit graph membership (edges from the store's import graph) and non-removable-input evidence (declared, observed reads, snapshot, resolution candidates, glob listings, environment). A pair whose input kind cannot be proved is not estimated and is counted under a reason. Count importers from edges, independent of route precedence.
- Owns: `src/core/reach/**`, `src/cli/reach*.ts`, `test/reach/**`.
- Leave alone: `src/runners/**`, `src/core/ci/**`, `src/core/store/**` (022-03r, contract).
- Done when: the review's two fixtures are tests (resolution input: 0 avoidable seconds; two graph importers, one also marked as a loaded module: importedBy 2), plus an import also held by a non-removable input; exact seconds and counts in text and JSON; D11's read-only rules hold.
- Use /worker.
