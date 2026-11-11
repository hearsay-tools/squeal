# Spec 020 wave 7: order across runners, and a quality scan

Approved by the human on 2026-11-11: #187 "Close + build row"; "Quality: Scan only" (no evals).

## 020-19 order across runners (#187)

Use /worker. Shape: slice. Baseline: main after release 0.1.433.

Outcome: spec D18. The gate runs the runner with the smaller estimate first, so short node:test files are not starved behind a large Vitest selection.

Read: spec D17 and D18; `research/issue-187.md`; `src/core/code/gate/collect.ts` (the runner loop after `plan`) and `plan.ts`.

Starting seam: a pure function in `src/core/code/gate/order.ts` (or a new `runner-order.ts`) that orders runners by their planned estimate, with D18.2's rules for unknown estimates and ties. First failing test: a fixture with a slow Vitest selection and one quick node:test file under a short budget; today the node:test file reads `not-finished`, after the change it completes.

Owns: `order.ts` or the new file, the runner loop in `collect.ts`, the runner order of the pre-run print in `prerun.ts`, their tests, and one sentence in `commands.md` (with copies).

Done when: the fixture passes; ties keep today's order; the report and verdicts of existing gate tests are unchanged apart from order; lint and typecheck are clean; `squeal status --wait 60000 <changed paths>` shows only bundle drift. Do not run `pnpm run build` or a full suite.

## Quality scan over spec 020

Use /quality. Read-only.

Stretch: spec 020 from its draft (`90158d0f1`) to release 0.1.433 (`53cd6aae4`): rows 020-01 to 020-18 and the 020-17 rows. Main directories: `src/core/code/gate/`, `src/cli/code-gate*.ts`, `src/core/code/crap/`, `src/core/code/count/`, `src/core/ci/`, `src/runners/*/` where the rows touched them, `test/code/gate/`, `test/cli/code-gate*`, and the skill references `commands.md` and `policy.md`.

Known leads to confirm or drop: `src/core/code/gate/collect.ts` is 561 lines (the 020-17 integration notes name `plan`, `storedOf` and `preparedBefore` as parts to move out); `listingMetaKey` may be unread since 020-07b; `src/core/code/gate/stored.ts` may duplicate `openKeys` from `src/core/ci/export.ts`; `test/cli/code-gate-parts-cases.test.ts` is 319 lines.

Write `docs/specifications/020-quality-gate/quality/2026-11.md`. No evals (the human, 2026-11-11). Do not run a full suite or `pnpm run build`.

## 020-20 the gate certifies a part's inputs as the record path keys them

Use /worker. Shape: repair. Baseline: main.

Outcome: `--parts` takes a part only when every input the daemon would key is unchanged, symlink targets included, through one shared rule.

Read: `quality/2026-11.md`, row `proposed-gate-parts-inputs`; spec D13.2; `src/core/code/gate/parts.ts` (`inputsOf`, `listingsBelow`, `hereOf`), `src/core/scheduler/observed.ts` (`observedGrowth`, `linkTargets`), `src/core/ci/export-inputs.ts` (`certifier`, `here`).

Starting seam: a failing test first: a part whose test reads `data.json` through a symlink; after `ci record`, change the target; `--parts` must not take it, and the file runs. Then one pure "inputs of an observed read" in `scheduler/observed.ts` (closure, read paths, link targets, listings, minus scratch), called by `observedGrowth` and `inputsOf`; move `here` to `src/core/ci/inputs.ts` with the file hash as an argument.

Owns: `gate/parts.ts`, `scheduler/observed.ts`, `ci/export-inputs.ts`, `ci/inputs.ts`, their tests.

Leave alone: `collect.ts`, `order.ts`, `prerun.ts` (020-19); `scheduler/runner-work.ts` and `batch.ts` (spec 021).

Done when: the symlink case is refused and the unchanged part is taken; `parts.ts` has no listing or `.git` branch of its own; the existing parts, export and observed tests pass; `test/keys/key-format.test.ts` passes with keys unchanged; lint and typecheck are clean. Do not run `pnpm run build` or a full suite.
