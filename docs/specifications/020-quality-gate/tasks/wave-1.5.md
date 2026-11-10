# Spec 020 wave 1.5: repair of review 0.1.423

## 020-06 repair R1: changed tests always run, an unfinished loader never passes, full provenance

Use /worker. Shape: repair, on the candidate branch.

Outcome: the two false passes of `reviews/0.1.423.md` exit 3 (incomplete), and the report carries the provenance S1 names.

Read: `docs/specifications/020-quality-gate/reviews/0.1.423.md` whole, including its reproduction harness; spec D3.1, D3.4, D5 and D7 as amended 2026-11-10; the last lines of `status.md`.

Starting seam: turn the review's harness into two failing end-to-end tests in `test/cli/code-gate.test.ts`, using `test/cli/code-gate-fixture.ts`. Then fix them:

- **B1:**
  - Add `paths: readonly RelativePath[]` to `ChangedSet` in `src/core/code/gate/types.ts`. It holds every changed path of the diff, in path order, whatever its extension or `complexity.include`. The coordinator approves this one contract change. `changedFunctions` fills it, and the CLI's path narrowing narrows it.
  - `collectEvidence` selects from `changed.paths`: `affected()` for each path, plus each path a runner lists as a test file. It returns early only when `paths` and `--test` are both empty.
  - A regression test for a changed test whose functions only moved or shifted.
- **B2:**
  - In `evaluate`, a loading file that did not finish rules out a pass. The function reads `incomplete` with the gap `not-finished`, and the subset pass stays only over completed loaders.
  - Any unfinished selected file makes the verdict at least `incomplete`.
  - If the Vitest adapter can give failures seen in an unfinished file without changing what the daemon reads from `RunReport`, put them in the report's `failed`. If it cannot, leave it and say so in your final message. Do not change the daemon's run contract.
  - Add the no-failure timeout control as a test: an unfinished loader with no failure also exits 3.
- **S1:** put the base counting keys (`complexity.include`, `complexity.exclude`, `complexity.maxFileBytes`) in `base`, and every changed regular file's blob in `head.paths`, uncounted ones included. Update the golden test.

Owns: `src/core/code/gate/*` (the `types.ts` change above only), `src/cli/code-gate*.ts`, `src/runners/vitest/` only if the optional B2 failures need an additive export, `test/code/gate/*`, `test/cli/code-gate*`.

Leave alone: `src/core/code/crap/*`, the daemon, the bundles and `package.json`. Do not run `pnpm run build`; the coordinator rebuilds.

Done when: both review reproductions exit 3 end to end; the moved-only test change and the no-failure timeout control are covered; the golden test shows the S1 fields; `squeal status --wait 60000 <changed paths>` is current apart from bundle drift; lint and typecheck are clean.
